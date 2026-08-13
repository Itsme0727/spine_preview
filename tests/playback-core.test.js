const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
    console,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    Promise,
    Uint8Array,
    performance: { now: () => 0 },
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: {},
    Image: function Image() {},
    Blob: function Blob() {},
    URL: {},
};
context.window = context;
vm.createContext(context);

function load(relativePath) {
    const filename = path.join(root, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

load('js/data-model.js');
load('js/grid-connections.js');
load('js/layer-node-v2.js');
load('js/spine-loading.js');
load('js/spine-rendering.js');
load('js/ui-dom.js');
load('js/interaction.js');
load('js/export-ai-json.js');

const SMTool = context.SMTool;
const SMData = context.SMData;

function animation(name, duration) {
    return { name, duration };
}

function makeOwner() {
    const animations = [animation('idle', 2), animation('attack', 1), animation('fx', 4)];
    return {
        _trackMode: true,
        _trackSequence: [],
        skeletonData: {
            animations,
            findAnimation(name) { return animations.find((item) => item.name === name) || null; },
        },
        animations,
    };
}

function testTrackDurationUsesRealOverlapAndLongestParallelTrack() {
    const owner = makeOwner();
    owner._trackSequence = [
        {
            enabled: true,
            animations: [
                { name: 'idle', mixOut: 0.5 },
                { name: 'attack', mixOut: 0 },
            ],
        },
        { enabled: true, animations: [{ name: 'fx', mixOut: 0 }] },
    ];
    assert.equal(SMTool._trackSequenceDurationSeconds(owner, owner._trackSequence[0]), 2.5);
    assert.equal(SMTool._trackNodeDurationSeconds(owner), 4);
}

function testNativeQueueMixStartsBeforePreviousAnimationEnds() {
    const owner = makeOwner();
    const entries = [];
    const state = {
        setAnimation(index, name, loop) {
            const entry = { index, animation: owner.skeletonData.findAnimation(name), loop, trackTime: 0, next: null };
            entries.push(entry);
            return entry;
        },
        addAnimation(index, name, loop) {
            const entry = { index, animation: owner.skeletonData.findAnimation(name), loop, trackTime: 0, next: null };
            entries[entries.length - 1].next = entry;
            entries.push(entry);
            return entry;
        },
        clearTrack() {},
    };
    const sequence = [{
        enabled: true,
        loopSeq: false,
        alpha: 1,
        animations: [
            { name: 'idle', mixOut: 0.5 },
            { name: 'attack', mixOut: 0 },
        ],
    }];
    SMTool._buildNativeTrackSequence(owner, state, sequence, '3.8', 0, true);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].mixDuration, 0.5);
    assert.equal(entries[1].delay, 1.5);
}

function testSwitchBackToNormalModeClearsTrackPoseBeforeReapply() {
    const calls = [];
    const owner = makeOwner();
    Object.assign(owner, {
        id: 99,
        _trackMode: false,
        _spineVer: '4.2',
        currentAnim: 'idle',
        loop: true,
        tracks: [{ animName: 'idle', alpha: 1, mixBlend: 'replace', enabled: true, loop: true, mixDuration: 0 }],
        _trackMixSlotGuards: { 1: {} },
        _pendingTrackMixSlotRestore: [{ slot: { color: { a: 0.2 } }, alpha: 1 }],
        skeleton: {
            setToSetupPose() { calls.push('setup'); },
            updateWorldTransform() { calls.push('world'); },
        },
        state: {
            data: { setMix() {} },
            clearTracks() { calls.push('clear'); },
            setAnimation(index, name) { calls.push(`set:${index}:${name}`); return {}; },
            update() { calls.push('update'); },
            apply() { calls.push('apply'); },
        },
    });
    SMTool._applyTracksToState(owner);
    assert.ok(calls.indexOf('clear') < calls.indexOf('setup'));
    assert.ok(calls.indexOf('setup') < calls.indexOf('set:0:idle'));
    assert.ok(calls.indexOf('set:0:idle') < calls.lastIndexOf('apply'));
    assert.deepEqual(Object.keys(owner._trackMixSlotGuards), []);
    assert.equal(owner._pendingTrackMixSlotRestore, null);
}

function layerNode(id, count) {
    return { id, nodeType: 'layer', _layerData: { layerCount: count, layers: {} } };
}

function testPlaybackTreeUsesPathLocalCycleDetection() {
    const rootLayer = layerNode(1, 2);
    const reusedLayer = layerNode(2, 1);
    const leafA = { id: 3, nodeType: 'delayer' };
    SMData.nodes = new Map([[1, rootLayer], [2, reusedLayer], [3, leafA]]);
    SMData.connections = [
        { fromNode: 1, toNode: 2, _layerNum: 1 },
        { fromNode: 1, toNode: 2, _layerNum: 2 },
        { fromNode: 2, toNode: 3, _layerNum: 1 },
    ];
    const tree = SMTool._buildPlaybackTree(rootLayer, 0);
    assert.equal(tree.layers[0].chainNodeIds.length, 0);
    assert.ok(tree.layers[0].subLayerTree);
    assert.ok(tree.layers[1].subLayerTree, 'second sibling reference must not be misclassified as a cycle');
    assert.deepEqual(Array.from(tree.layers[1].subLayerTree.layers[0].chainNodeIds), [3]);
}

function testHiddenLayerStillAdvancesToBarrier() {
    const delay = { _chainNodeId: 10, _isDelayer: true, _delayValue: 0.1 };
    const layer = {
        _hidden: true,
        _suppressDraw: true,
        _chainSkeletons: [delay],
        _chainIdx: 0,
        _chainDone: false,
        _delayElapsed: 0,
    };
    const result = SMTool._renderOneNormalLayer(layer, 0.2, false, {}, null, {});
    assert.equal(result.chainDone, true);
    assert.equal(layer._chainDone, true);
}

function testLoopResetRewindsRuntimeState() {
    let clearCount = 0;
    let setCount = 0;
    const skeleton = {
        setToSetupPose() {},
        updateWorldTransform() {},
    };
    const entry = {
        _chainNodeId: 20,
        _chainAnimName: 'idle',
        _trackMode: false,
        state: {
            clearTracks() { clearCount++; },
            setAnimation() { setCount++; return {}; },
            update() {},
            apply() {},
        },
        skeleton,
    };
    SMData.nodes.set(20, { id: 20, nodeType: 'spine', currentAnim: 'idle', loop: false });
    const layer = {
        _chainDone: true,
        _chainIdx: 1,
        _delayElapsed: 3,
        _chainSkeletons: [entry],
        _hidePermanent: true,
    };
    SMTool._resetLayerRuntimeEntry(layer);
    assert.equal(layer._chainIdx, 0);
    assert.equal(layer._chainDone, false);
    assert.equal(layer._delayElapsed, 0);
    assert.equal(layer._hidePermanent, false);
    assert.equal(clearCount, 1);
    assert.equal(setCount, 1);
}

function testParallelLayerDoesNotOverwriteItsFirstChainNodeWhileRenderingLaterNodes() {
    const drawn = [];
    function makeState() {
        let current = { trackTime: 0, animation: { duration: 1 } };
        return {
            clearTracks() { current = null; },
            setAnimation() { current = { trackTime: 0, animation: { duration: 1 } }; return current; },
            getCurrent() { return current; },
            update() {},
            apply() {},
        };
    }
    function makeSkeleton(name) {
        return {
            name,
            setToSetupPose() {},
            updateWorldTransform() {},
        };
    }

    const firstSkeleton = makeSkeleton('first-frame-zero');
    const secondSkeleton = makeSkeleton('later-node');
    const firstState = makeState();
    const secondState = makeState();
    const first = {
        _chainNodeId: 81,
        _chainAnimName: 'first',
        skeleton: firstSkeleton,
        state: firstState,
    };
    const second = {
        _chainNodeId: 82,
        _chainAnimName: 'second',
        skeleton: secondSkeleton,
        state: secondState,
        sceneRenderer: {
            begin() {},
            drawSkeleton(skeleton) { drawn.push(skeleton.name); },
            end() {},
        },
    };

    // 真实项目中的层运行时对象就是 chain[0]；旧实现会在这里把 first
    // 的 skeleton/state 永久覆盖成 second，导致下一轮索引归零也无法回首帧。
    const layer = first;
    layer._chainSkeletons = [first, second];
    layer._chainIdx = 1;
    layer._chainDone = false;
    SMData.nodes.set(81, { id: 81, nodeType: 'spine', currentAnim: 'first', loop: false });
    SMData.nodes.set(82, { id: 82, nodeType: 'spine', currentAnim: 'second', loop: false });

    const gl = {
        STENCIL_BUFFER_BIT: 1,
        BLEND: 2,
        ONE: 3,
        ONE_MINUS_SRC_ALPHA: 4,
        clear() {},
        enable() {},
        blendFunc() {},
    };
    SMTool._renderOneNormalLayer(layer, 0, true, gl, null, {});

    assert.equal(first.skeleton, firstSkeleton, 'rendering a later node must not corrupt chain[0].skeleton');
    assert.equal(first.state, firstState, 'rendering a later node must not corrupt chain[0].state');
    assert.deepEqual(drawn, ['later-node']);

    SMTool._resetLayerRuntimeEntry(layer);
    assert.equal(layer._chainIdx, 0);
    assert.equal(layer._renderEntry, first);
    assert.equal(layer._renderEntry.skeleton, firstSkeleton);
}

function testCountLoopBranchStopsOnRealFinalFrameBeforeBarrier() {
    const calls = [];
    const entry = {
        loop: true,
        trackTime: 2,
        animation: { duration: 1 },
    };
    const active = {
        _chainNodeId: 23,
        state: {
            update() { calls.push('update'); },
            apply() { calls.push(`apply:${entry.trackTime}`); },
            getCurrent() { return entry; },
        },
        skeleton: {
            setToSetupPose() { calls.push('setup'); },
            updateWorldTransform() { calls.push('world'); },
        },
    };
    SMData.nodes.set(23, {
        id: 23,
        nodeType: 'spine',
        loop: true,
        _loopMode: 'count',
        _loopCount: 2,
        _playbackSpeed: 1,
    });
    const layer = {
        _chainDone: false,
        _chainIdx: 0,
        _chainSkeletons: [active],
        _loopTrack: { currentLoop: 0, totalElapsed: 0 },
    };

    const result = SMTool._advanceLayerChain(layer, 0, false);

    assert.equal(result.shouldAdvance, true);
    assert.equal(entry.loop, false);
    assert.equal(entry.trackTime, 1);
    assert.ok(calls.includes('apply:1'));
}

function testParallelCycleRestartRewindsEveryLayerInOneBatch() {
    const rendered = [];
    const oldRender = SMTool._renderLayerPreview;
    SMTool._renderLayerPreview = (layerNode, preview, now) => {
        rendered.push({ frozen: preview._flowFrozen, now });
    };

    function makeLayerEntry(id, oldTime) {
        let current = { trackTime: oldTime };
        return {
            _chainDone: true,
            _chainIdx: 1,
            _chainSkeletons: [{
                _chainNodeId: id,
                _chainAnimName: 'idle',
                state: {
                    clearTracks() { current = null; },
                    setAnimation() { current = { trackTime: 0 }; return current; },
                    getCurrent() { return current; },
                    update() {},
                    apply() {},
                },
                skeleton: { setToSetupPose() {}, updateWorldTransform() {} },
            }],
            getCurrentTime() { return current && current.trackTime; },
        };
    }

    const layerA = makeLayerEntry(21, 1.4);
    const layerB = makeLayerEntry(22, 3.7);
    SMData.nodes.set(21, { id: 21, nodeType: 'spine', currentAnim: 'idle', loop: false });
    SMData.nodes.set(22, { id: 22, nodeType: 'spine', currentAnim: 'idle', loop: false });
    const preview = {
        _layerSkeletons: [layerA, layerB],
        _subtreeCache: {},
        _flowFrozen: false,
        _allLayersCompletedOnce: true,
        _layerPlaybackState: { treeCompleted: true },
    };

    SMTool._restartLayerPreviewCycle(preview, 500);
    SMTool._renderLayerPreview = oldRender;

    assert.equal(layerA._chainIdx, 0);
    assert.equal(layerB._chainIdx, 0);
    assert.equal(layerA._chainDone, false);
    assert.equal(layerB._chainDone, false);
    assert.equal(layerA.getCurrentTime(), 0);
    assert.equal(layerB.getCurrentTime(), 0);
    assert.equal(preview._allLayersCompletedOnce, false);
    assert.equal(preview._layerPlaybackState.treeCompleted, false);
    assert.deepEqual(rendered, [
        { frozen: true, now: 500 },
        { frozen: true, now: 500 },
    ]);
    assert.equal(preview._flowFrozen, false);
    assert.equal(preview._parallelBarrierCommitted, false);
    assert.equal(preview._parallelRestarting, false);
}

function testPreviewControlAndFlowRestartSourceOrder() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'js/ui-dom.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.match(html, /id="appPauseBtn"[^>]+onclick="event\.stopPropagation\(\); SMTool\._togglePreviewPause\(\)"[^>]+ondblclick="event\.stopPropagation\(\)"/);
    assert.ok(!uiSource.includes('_pauseToggleLock'), 'rapid clicks must not be debounced');
    assert.match(appSource, /closest\('#animPreviewPanel button'\)/);

    const playStart = uiSource.indexOf('SMTool._playFullStep = function');
    const playEnd = uiSource.indexOf('SMTool._tickFullPlayback = function', playStart);
    const playSource = uiSource.slice(playStart, playEnd);
    assert.ok(
        playSource.indexOf('SMTool._applyStepToMainNode(stepNode)') <
        playSource.indexOf('SMTool._showAnimPreview(spineNode, true,'),
        'flow step must be applied at frame zero before rebuilding the preview'
    );
    assert.match(playSource, /SMTool\._restartFullPlaybackFromStart\(\)/);
    assert.ok(!playSource.includes('SMTool._updateFullFlowPanel('),
        'playback step changes must never rebuild the complete flow list');
    assert.match(playSource, /SMTool\._scheduleFullPlaybackVisualRefresh\(\)/);
    const renderSource = fs.readFileSync(path.join(root, 'js/spine-rendering.js'), 'utf8');
    assert.match(renderSource, /flowOwnsPreviewClock/);
    assert.match(renderSource, /sk\.setToSetupPose\(\);\s*for \(var resetTi/);
    const layerSource = fs.readFileSync(path.join(root, 'js/layer-node-v2.js'), 'utf8');
    assert.match(layerSource, /state\.setAnimation\(0, animName, hasExplicitLoop\)/);
}

function testPreviewRestartPrioritizesWholeActiveFlow() {
    const calls = [];
    const oldRestartFlow = SMTool._restartFullPlaybackFromStart;
    SMTool._restartFullPlaybackFromStart = () => { calls.push('restart-flow'); return true; };
    SMData._animPreview = {
        visible: true,
        nodeId: 999,
        _playbackOwner: { type: 'flow', pathIdx: 0, nodeId: 2 },
        skeleton: {},
        state: {
            getCurrent() {
                calls.push('rewind-current-node');
                return { trackTime: 4 };
            },
        },
    };
    SMData._fullPaths = [{ nodes: [{ id: 1, anim: 'first' }, { id: 2, anim: 'second' }] }];
    SMData._fullPlayback = { activePathIdx: 0, currentStep: 1, isPlaying: true, _timer: null };

    SMTool._restartPreview();
    SMTool._restartFullPlaybackFromStart = oldRestartFlow;

    assert.deepEqual(calls, ['restart-flow']);
}

function testFiniteTrackPassNeverPrequeuesAnUnauthorizedNextCycle() {
    const owner = makeOwner();
    owner._trackSequence = [{
        enabled: true,
        loopSeq: true,
        alpha: 1,
        animations: [
            { name: 'idle', mixOut: 0.25 },
            { name: 'attack', mixOut: 0 },
        ],
    }];
    const finite = SMTool._finiteTrackSequences(owner._trackSequence);
    const entries = [];
    const state = {
        setAnimation(index, name, loop) {
            const entry = { index, name, loop, next: null };
            entries.push(entry);
            return entry;
        },
        addAnimation(index, name, loop) {
            const entry = { index, name, loop, next: null };
            entries[entries.length - 1].next = entry;
            entries.push(entry);
            return entry;
        },
    };

    SMTool._buildNativeTrackSequence(owner, state, finite, '4.2', 0, false);

    assert.equal(owner._trackSequence[0].loopSeq, true, 'authored track configuration must stay unchanged');
    assert.equal(finite[0].loopSeq, false);
    assert.equal(entries.length, 2, 'finite playback must queue exactly one sequence pass');
    assert.equal(owner._trackQueueRuntime[0].loop, false);
}

function testPreviewRestartDispatchesByExplicitOwnerNotStaleSelectedFlow() {
    const calls = [];
    const oldRestartFlow = SMTool._restartFullPlaybackFromStart;
    const oldRestartParallel = SMTool._restartLayerPreviewCycle;
    const oldRestartSingle = SMTool._restartAnimPreviewStateAtZero;
    SMTool._restartFullPlaybackFromStart = () => calls.push('flow');
    SMTool._restartLayerPreviewCycle = () => calls.push('parallel');
    SMTool._restartAnimPreviewStateAtZero = () => calls.push('single');
    SMData._fullPaths = [{ nodes: [{ id: 1 }, { id: 2 }] }];
    SMData._fullPlayback = { activePathIdx: 0, currentStep: 1, isPlaying: false, _isPaused: false };
    SMData.nodes.set(77, { id: 77, nodeType: 'spine' });

    SMData._animPreview = {
        visible: true,
        nodeId: 77,
        _playbackOwner: { type: 'single', nodeId: 77 },
        skeleton: {},
        state: {},
        _flowFrozen: false,
        _layerSkeletons: null,
    };
    SMTool._restartPreview();

    SMData._animPreview._playbackOwner = { type: 'parallel', nodeId: 88 };
    SMData._animPreview._layerSkeletons = [{}];
    SMTool._restartPreview();

    // 一旦完整流程确实正在运行，即使浮窗 owner 被异步改写成 single，
    // “重头播放”仍必须回到整条流程源头。
    SMData._fullPlayback.isPlaying = true;
    SMData._animPreview._playbackOwner = { type: 'single', nodeId: 77 };
    SMData._animPreview._layerSkeletons = null;
    SMTool._restartPreview();

    // 暂停中的流程仍然拥有浮窗；重播必须清除暂停并从流程源头启动。
    SMData._fullPlayback.isPlaying = false;
    SMData._fullPlayback._isPaused = true;
    SMTool._restartPreview();

    // 用户主动点选了新动画节点后，浮窗已脱离暂停的原流程。
    SMData._animPreview._playbackOwner = { type: 'single', nodeId: 77, manualSelection: true };
    SMTool._restartPreview();

    SMTool._restartFullPlaybackFromStart = oldRestartFlow;
    SMTool._restartLayerPreviewCycle = oldRestartParallel;
    SMTool._restartAnimPreviewStateAtZero = oldRestartSingle;
    assert.deepEqual(calls, ['single', 'parallel', 'flow', 'flow', 'single']);
}

function testPreviewAttachmentsLayerThumbnailsAndCanvasPerformanceContracts() {
    const uiSource = fs.readFileSync(path.join(root, 'js/ui-dom.js'), 'utf8');
    const layerSource = fs.readFileSync(path.join(root, 'js/layer-node-v2.js'), 'utf8');
    const renderSource = fs.readFileSync(path.join(root, 'js/spine-rendering.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

    assert.match(uiSource, /manualSelection:\s*true/);
    assert.match(uiSource, /SMTool\._setPreviewPauseUI\(false\)/);
    assert.match(renderSource, /!pp\._needsLayerRebuild && !SMData\._hideBoneImgs/);
    assert.match(renderSource, /SMData\._hideBoneImgs \|\| !srcNode \|\| !srcNode\._slotScreenshots/);
    assert.match(renderSource, /layerEntry\._hidden \|\| layerEntry\._suppressDraw/);

    assert.match(layerSource, /class="all-layer-thumb"/);
    assert.match(layerSource, /_updateLayerListThumbnails/);
    assert.match(layerSource, /_lastLayerThumbTime \|\| 0\) < 800/);
    assert.match(layerSource, /_syncLayerListPreviewMode\(true, true\)/);
    assert.match(cssSource, /\.all-item\s*\{[\s\S]*?min-height:\s*122px/);
    assert.match(cssSource, /\.all-layer-thumb\s*\{[\s\S]*?background:\s*transparent/);
    assert.match(cssSource, /\.hidden-layer \.all-layer-thumb\s*\{\s*visibility:\s*hidden/);

    const updatePosStart = uiSource.indexOf('SMTool._updatePos = function');
    const updatePosEnd = uiSource.indexOf('SMTool._allPosScheduled', updatePosStart);
    const updatePosBody = uiSource.slice(updatePosStart, updatePosEnd);
    assert.ok(!updatePosBody.includes('SMTool._updateFloatLabels();'),
        'single node positioning must not synchronously traverse every floating label');
    assert.match(uiSource, /SMTool\._scheduleFloatLabelsUpdate/);
    assert.match(renderSource, /SMTool\._updateAllPos\(false\)/);
    assert.match(renderSource, /canvasGestureActive/);
    assert.match(renderSource, /_deferredAnimDt/);
    const loopSource = renderSource.slice(renderSource.indexOf('SMTool._loop = function'), renderSource.indexOf('// ---- 缩放 ----'));
    assert.ok(loopSource.indexOf('SMTool._renderAnimPreview(now);') < loopSource.indexOf('var gl = SMTool._sharedGL;'),
        'floating preview must render before shared canvas and connection work');

    const oldDocument = context.document;
    const classes = new Set(['paused']);
    const pauseBtn = {
        textContent: '▶',
        title: '继续播放',
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        },
    };
    context.document = { getElementById: (id) => id === 'appPauseBtn' ? pauseBtn : null };
    SMTool._setPreviewPauseUI(false);
    context.document = oldDocument;
    assert.equal(classes.has('paused'), false);
    assert.equal(pauseBtn.textContent, '⏸');
    assert.equal(pauseBtn.title, '暂停播放');
}

function testParallelBarrierCommitsOnlyOncePerCycle() {
    const oldRenderOne = SMTool._renderOneLayer;
    const oldRestart = SMTool._restartLayerPreviewCycle;
    const oldHighlights = SMTool._updateLayerPlayingHighlights;
    const oldList = SMTool._updateLayerListCurrentNodes;
    const oldBranches = SMTool._refreshFlowBranchHighlights;
    let restartCount = 0;
    SMTool._renderOneLayer = (layer) => ({
        activeNodeId: null,
        activeProgress: 1,
        chainDone: layer._chainDone,
    });
    SMTool._restartLayerPreviewCycle = () => { restartCount++; };
    SMTool._updateLayerPlayingHighlights = () => {};
    SMTool._updateLayerListCurrentNodes = () => {};
    SMTool._refreshFlowBranchHighlights = () => {};

    const gl = {
        COLOR_BUFFER_BIT: 1,
        STENCIL_BUFFER_BIT: 2,
        viewport() {},
        clearColor() {},
        clearStencil() {},
        clear() {},
    };
    const preview = {
        _layerSkeletons: [
            { _chainDone: true, _chainIdx: 0, _lastRptChainIdx: 0, _lastRptChainDone: true, sceneRenderer: {} },
            { _chainDone: false, _chainIdx: 0, _lastRptChainIdx: 0, _lastRptChainDone: false, sceneRenderer: {} },
        ],
        gl,
        canvas: { width: 100, height: 100 },
        _flowFrozen: false,
        _lastTime: 10,
        _playbackOwner: { type: 'parallel', nodeId: 88 },
        _parallelBarrierCommitted: false,
        _layerPlaybackState: {},
    };

    SMTool._renderLayerPreview(null, preview, 20);
    assert.equal(restartCount, 0, 'completed short branch must wait at the barrier');
    assert.equal(preview._parallelBarrierCommitted, false);
    preview._layerSkeletons[1]._chainDone = true;
    SMTool._renderLayerPreview(null, preview, 30);
    SMTool._renderLayerPreview(null, preview, 40);

    SMTool._renderOneLayer = oldRenderOne;
    SMTool._restartLayerPreviewCycle = oldRestart;
    SMTool._updateLayerPlayingHighlights = oldHighlights;
    SMTool._updateLayerListCurrentNodes = oldList;
    SMTool._refreshFlowBranchHighlights = oldBranches;
    assert.equal(restartCount, 1);
    assert.equal(preview._parallelBarrierCommitted, true);
}

function testFullPlaybackUnifiedClockAdvancesAndRestartsAtomically() {
    const calls = [];
    const oldPlay = SMTool._playFullStep;
    const oldRestart = SMTool._restartFullPlaybackFromStart;
    SMTool._playFullStep = () => calls.push('next-step');
    SMTool._restartFullPlaybackFromStart = () => calls.push('restart-source');
    SMData._fullPaths = [{ nodes: [{ id: 1 }, { id: 2 }] }];
    SMData._fullPlayback = {
        activePathIdx: 0,
        currentStep: 0,
        isPlaying: true,
        _clockStep: 0,
        _clockMode: 'timed-step',
        _stepElapsed: 0,
        _stepDuration: 0.5,
    };

    SMTool._tickFullPlayback(0.2);
    assert.deepEqual(calls, []);
    SMTool._tickFullPlayback(0.3);
    assert.deepEqual(calls, ['next-step']);
    assert.equal(SMData._fullPlayback.currentStep, 1);

    Object.assign(SMData._fullPlayback, {
        _clockStep: 1,
        _clockMode: 'timed-step',
        _stepElapsed: 0,
        _stepDuration: 0.1,
    });
    SMTool._tickFullPlayback(0.1);

    SMTool._playFullStep = oldPlay;
    SMTool._restartFullPlaybackFromStart = oldRestart;
    assert.deepEqual(calls, ['next-step', 'restart-source']);
}

function testRapidPauseClicksToggleFlowWithoutRestartingIt() {
    const calls = [];
    const oldDocument = context.document;
    const oldPause = SMTool._pauseFullPlayback;
    const oldResume = SMTool._resumeFullPlayback;
    const oldRestart = SMTool._restartFullPlaybackFromStart;
    context.document = { getElementById: () => null };
    SMData._fullPlayback = {
        activePathIdx: 0,
        currentStep: 1,
        isPlaying: true,
        _isPaused: false,
    };
    SMData._animPreview = {
        visible: true,
        _flowFrozen: false,
        _playbackOwner: { type: 'flow', pathIdx: 0, nodeId: 2 },
    };
    SMTool._pauseFullPlayback = () => {
        calls.push('pause');
        SMData._fullPlayback.isPlaying = false;
        SMData._fullPlayback._isPaused = true;
    };
    SMTool._resumeFullPlayback = () => {
        calls.push('resume');
        SMData._fullPlayback.isPlaying = true;
        SMData._fullPlayback._isPaused = false;
    };
    SMTool._restartFullPlaybackFromStart = () => calls.push('restart');

    SMTool._togglePreviewPause();
    SMTool._togglePreviewPause();

    context.document = oldDocument;
    SMTool._pauseFullPlayback = oldPause;
    SMTool._resumeFullPlayback = oldResume;
    SMTool._restartFullPlaybackFromStart = oldRestart;
    assert.deepEqual(calls, ['pause', 'resume']);
}

function testResumingLogicalFlowStepKeepsPrimedPreviewFrozen() {
    const oldPauseOthers = SMTool._pauseAllNodesExcept;
    const calls = [];
    SMTool._pauseAllNodesExcept = (id) => calls.push(id);
    SMData.nodes = new Map([[50, { id: 50, nodeType: 'delayer', _delayValue: 2 }]]);
    SMData._fullPaths = [{ nodes: [{ id: 50, anim: 'delay' }, { id: 51, anim: 'idle' }] }];
    SMData._fullPlayback = {
        activePathIdx: 0,
        currentStep: 0,
        isPlaying: false,
        _isPaused: true,
        _clockStep: 0,
        _clockMode: 'timed-step',
        _stepElapsed: 0.75,
        _stepDuration: 2,
    };
    SMData._animPreview = {
        visible: true,
        _flowFrozen: true,
        _playbackOwner: { type: 'flow', pathIdx: 0, nodeId: 50, previewOnly: true },
    };

    assert.equal(SMTool._resumeFullPlayback(), true);

    SMTool._pauseAllNodesExcept = oldPauseOthers;
    assert.equal(SMData._fullPlayback.isPlaying, true);
    assert.equal(SMData._fullPlayback._stepElapsed, 0.75);
    assert.equal(SMData._animPreview._flowFrozen, true);
    assert.deepEqual(calls, [50]);
}

function testLogicalFlowSourcePrimesFirstRenderableFrameZero() {
    const calls = [];
    const oldShow = SMTool._showAnimPreview;
    SMTool._showAnimPreview = (node, restartAtZero, owner) => {
        calls.push({ id: node.id, restartAtZero, owner });
    };
    const renderable = { id: 61, nodeType: 'spine' };
    SMData.nodes = new Map([
        [60, { id: 60, nodeType: 'delayer' }],
        [61, renderable],
    ]);
    SMData._animPreview = { visible: true, _flowFrozen: false };
    const path = { nodes: [{ id: 60, anim: 'delay' }, { id: 61, anim: 'idle' }] };
    const owner = { type: 'flow', pathIdx: 0, nodeId: 60 };

    const result = SMTool._primeFlowPreviewFromSource(path, owner);

    SMTool._showAnimPreview = oldShow;
    assert.equal(result, renderable);
    assert.equal(SMData._animPreview._flowFrozen, true);
    assert.equal(JSON.stringify(calls), JSON.stringify([{
        id: 61,
        restartAtZero: true,
        owner: {
            type: 'flow',
            pathIdx: 0,
            nodeId: 60,
            previewNodeId: 61,
            previewOnly: true,
        },
    }]));
}

function testSameSourceFlowStepForcesExactPreviewFrameZero() {
    const calls = [];
    let current = { trackTime: 2.75, timeScale: 1, loop: true };
    const preview = {
        visible: true,
        nodeId: 2,
        animName: 'same-name',
        _spineVer: '4.2',
        _skeletonData: { animations: [{ name: 'same-name' }] },
        _flowFrozen: false,
        _playbackOwner: { type: 'flow', pathIdx: 0, nodeId: 1 },
        state: {
            clearTracks() { calls.push('clear'); current = null; },
            setAnimation(index, name, loop) {
                current = { trackTime: 9, timeScale: 1, loop };
                calls.push(`set:${name}:${loop}`);
                return current;
            },
            getCurrent() { return current; },
            update(dt) { calls.push(`update:${dt}`); },
            apply() { calls.push('apply'); },
        },
        skeleton: {
            setToSetupPose() { calls.push('setup'); },
            updateWorldTransform() { calls.push('world'); },
        },
    };
    const sourceNode = {
        id: 1,
        nodeType: 'spine',
        currentAnim: 'same-name',
        animations: [{ name: 'same-name' }],
        tracks: [],
        loop: true,
        _loopMode: null,
        _loopCount: 1,
    };
    const oldRuntime = SMTool._getSpineRuntime;
    const oldRender = SMTool._renderAnimPreview;
    SMTool._getSpineRuntime = () => ({ AnimationStateData: function AnimationStateData() {} });
    SMTool._renderAnimPreview = () => calls.push(`render-frozen:${preview._flowFrozen}`);
    SMData._fullPlayback = { activePathIdx: 0, isPlaying: true };

    SMTool._restartAnimPreviewStateAtZero(preview, sourceNode);

    SMTool._getSpineRuntime = oldRuntime;
    SMTool._renderAnimPreview = oldRender;
    assert.equal(preview.nodeId, 1);
    assert.equal(current.trackTime, 0);
    assert.equal(current.loop, false);
    assert.ok(calls.indexOf('clear') < calls.lastIndexOf('setup'));
    assert.ok(calls.includes('render-frozen:true'));
    assert.equal(preview._flowFrozen, false);
}

function testBundledSpineFixtureIsComplete() {
    const fixtureDir = path.join(root, 'spine');
    const atlas = fs.readFileSync(path.join(fixtureDir, 'Character.atlas'), 'utf8');
    assert.ok(fs.statSync(path.join(fixtureDir, 'Character.skel')).size > 0);
    assert.ok(fs.statSync(path.join(fixtureDir, 'Character.png')).size > 0);
    assert.match(atlas, /Character\.png/);
}

function testBundledProjectZipParsesWithApplicationImporter() {
    const zipBytes = fs.readFileSync(path.join(root, 'spine-state-machine.zip'));
    const entries = SMTool._parseZip(new Uint8Array(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength));
    const projectEntry = entries.find((entry) => entry.name === 'spine-state-machine.json');
    assert.ok(projectEntry, 'project JSON must exist in the regression ZIP');
    assert.equal(projectEntry.compressed, false, 'current synchronous importer requires stored project JSON');
    const project = JSON.parse(Buffer.from(projectEntry.data).toString('utf8'));
    assert.equal(project.flowMode, 'full');
    assert.equal(project.nodes.length, 95);
    assert.equal(project.connections.length, 72);
    assert.equal(project.nodes.filter((node) => node.nodeType === 'layer').length, 7);
    assert.equal(entries.filter((entry) => entry.name.startsWith('_assets/')).length, 34);

    // 用户提供的七个并行节点都必须能展开为有效屏障树，不能因同层复用或嵌套误判成环。
    SMData.nodes = new Map(project.nodes.map((node) => [node.id, node]));
    SMData.connections = project.connections;
    for (const layer of project.nodes.filter((node) => node.nodeType === 'layer')) {
        const tree = SMTool._buildPlaybackTree(layer, 0);
        assert.ok(tree && tree.layers && tree.layers.length > 0, `layer ${layer.id} must build a playback tree`);
        assert.ok(tree.layers.length <= layer._layerData.layerCount);
    }
}

function testAIExportV3PreservesGraphAndTrackSemanticsWithoutMutation() {
    SMTool._translateName = (name) => name;
    const trackNode = makeOwner();
    Object.assign(trackNode, {
        id: 30,
        nodeType: 'spine',
        name: 'HeroAttack',
        sourceFile: 'hero.json',
        version: '4.2',
        currentAnim: 'idle',
        currentSkin: 'default',
        x: 120,
        y: 80,
        tracks: [],
        _trackName: '战斗轨道',
        _srcType: 'json',
        _srcFileNames: ['hero.json', 'hero.atlas', 'hero.png'],
        _srcSkelJson: { skeleton: {} },
        _srcAtlasText: 'hero.png\n',
        _srcTexDataUrl: 'data:image/png;base64,AA==',
        _playbackSpeed: 1.25,
        loop: true,
        _loopMode: 'count',
        _loopCount: 2,
        _mixTable: { 'idle→attack': 0.5 },
        bones: [],
        slots: [],
        skins: ['default'],
    });
    trackNode._trackSequence = [{
        enabled: true,
        alpha: 0.8,
        mixBlend: 'replace',
        loopSeq: false,
        animations: [
            { name: 'idle', mixOut: 0.5 },
            { name: 'attack', mixOut: 0 },
        ],
    }];
    const parallel = layerNode(31, 1);
    parallel.name = '并行播放';
    parallel.x = 300;
    parallel.y = 80;
    parallel._layerData.layers[1] = {
        animNodeId: 30,
        animName: 'idle',
        _containerOffset: { offX: 12, offY: -4 },
    };
    SMData.nodes = new Map([[30, trackNode], [31, parallel]]);
    SMData.connections = [{
        id: 40,
        fromNode: 31,
        fromState: 'layer_1',
        toNode: 30,
        toState: 'input',
        condition: 'isReady && stamina > 0',
        _mixDuration: 0.4,
        _layerNum: 1,
        cp1x: 10,
        cp1y: 20,
        cp2x: 30,
        cp2y: 40,
        color: '#ff0000',
    }];
    SMData.groups = [];
    SMData.view = { x: 5, y: 6, zoom: 1.2 };

    const result = SMTool._buildAIExportDocumentV3();
    assert.equal(result.formatVersion, '3.0.0');
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges[0].condition.raw, 'isReady && stamina > 0');
    assert.equal(result.graph.edges[0].from.parallelLayerNumber, 1);
    assert.equal(result.graph.edges[0].animationBlend.durationSeconds, 0.4);
    assert.equal(result.parallelCompositions[0].layers[0].containerOffsetPixels.x, 12);
    const exportedSpine = result.graph.nodes.find((node) => node.id === 'node:30').semantics.spine;
    assert.equal(exportedSpine.playback.stateMode, 'track-sequence');
    assert.equal(exportedSpine.playback.trackSequence[0].clips[1].startsAtSeconds, 1.5);
    assert.equal(exportedSpine.playback.durationPerPassSeconds, 2.5);
    assert.equal(exportedSpine.playback.defaultMixTable[0].durationSeconds, 0.5);
    assert.equal(result.gameProtocol.entities.length, 1);
    assert.equal(result.gameProtocol.states.length, 1);
    assert.equal(result.gameProtocol.transitions[0].trigger, 'parallel-barrier-complete');
    assert.equal(result.gameProtocol.transitions[0].guard.raw, 'isReady && stamina > 0');
    assert.equal(result.gameProtocol.transitions[0].animationBlend.durationSeconds, 0.4);
    assert.equal(result.gameProtocol.runtimeRules.noEligibleTransition, 'stop-current-flow-and-report');
    assert.equal(result.graph.nodes[0].runtimeTransform.authored, false);
    assert.equal(result.validation.status, 'valid-with-warnings');
    assert.equal(trackNode.tracks.length, 0, 'read-only AI export must not initialize legacy tracks');
}

function testConnectionMixUsesNativeSpineTransitionInParallelChain() {
    const calls = [];
    SMData.nodes = new Map([
        [101, { id: 101, nodeType: 'spine', sourceFile: 'hero.json', currentAnim: 'idle' }],
        [102, { id: 102, nodeType: 'spine', sourceFile: 'hero.json', currentAnim: 'walk' }],
    ]);
    SMData.connections = [{ id: 201, fromNode: 101, toNode: 102, _mixDuration: 0.2 }];
    const stateData = { setMix(from, to, duration) { calls.push(['mix', from, to, duration]); } };
    const state = {
        data: stateData,
        clearTracks() { calls.push(['clear']); },
        setAnimation(track, name, loop) { calls.push(['set', track, name, loop]); return { trackTime: 0 }; },
        update(dt) { calls.push(['update', dt]); },
        apply() { calls.push(['apply']); },
    };
    const skeleton = {
        setToSetupPose() { calls.push(['setup']); },
        updateWorldTransform() { calls.push(['world']); },
    };
    const skeletonData = {
        findAnimation(name) { return name === 'idle' ? { duration: 1.5 } : name === 'walk' ? { duration: 2 } : null; },
    };
    const fromEntry = { _chainNodeId: 101, _chainAnimName: 'idle', state: {}, skeleton: {} };
    const toEntry = { _chainNodeId: 102, _chainAnimName: 'walk', state, skeleton, _skeletonData: skeletonData };

    assert.equal(SMTool._prepareLayerConnectionMix(fromEntry, toEntry), true);
    assert.deepEqual(calls.find((entry) => entry[0] === 'mix'), ['mix', 'idle', 'walk', 0.2]);
    assert.equal(toEntry._connectionMixDuration, 0.2);
}

function testTrackRenamePropagatesConnectionPorts() {
    const node = { id: 301, nodeType: 'spine', _trackMode: true, _trackName: '轨道动画', sourceFile: 'hero.json' };
    SMData.nodes = new Map([[301, node]]);
    SMData.connections = [
        { id: 1, fromNode: 301, fromState: '轨道动画', toNode: 9, toState: 'idle' },
        { id: 2, fromNode: 9, fromState: 'idle', toNode: 301, toState: '轨道动画' },
    ];
    const oldDocument = context.document;
    const oldUpdateEl = SMTool._updateEl;
    const oldSchedule = SMTool._scheduleFloatLabelsUpdate;
    const oldFlow = SMTool._updateFlowPanel;
    const oldFullFlow = SMTool._updateFullFlowPanel;
    context.document = { getElementById: () => null };
    SMTool._updateEl = () => {};
    SMTool._scheduleFloatLabelsUpdate = () => {};
    SMTool._updateFlowPanel = () => {};
    SMTool._updateFullFlowPanel = () => {};

    assert.equal(SMTool._renameTrackNode(node, '战斗组合'), true);

    context.document = oldDocument;
    SMTool._updateEl = oldUpdateEl;
    SMTool._scheduleFloatLabelsUpdate = oldSchedule;
    SMTool._updateFlowPanel = oldFlow;
    SMTool._updateFullFlowPanel = oldFullFlow;
    assert.equal(node._trackName, '战斗组合');
    assert.equal(SMData.connections[0].fromState, '战斗组合');
    assert.equal(SMData.connections[1].toState, '战斗组合');
}

function testTrackNodesUseConnectionMixOnEveryActiveTrack() {
    const calls = [];
    const animations = [animation('idle', 1), animation('fx', 1), animation('walk', 1), animation('aim', 1)];
    const skeletonData = {
        animations,
        findAnimation(name) { return animations.find((item) => item.name === name) || null; },
    };
    const current = {};
    const stateData = { setMix(from, to, seconds) { calls.push(['mix', from, to, seconds]); } };
    const state = {
        data: stateData,
        clearTracks() { Object.keys(current).forEach((key) => delete current[key]); },
        getCurrent(track) { return current[track] || null; },
        setAnimation(track, name, loop) {
            const entry = { animation: skeletonData.findAnimation(name), trackTime: 0, loop };
            current[track] = entry;
            return entry;
        },
        addAnimation(track, name, loop) { return this.setAnimation(track, name, loop); },
        update() {},
        apply() {},
        setEmptyAnimation(track, seconds) { calls.push(['empty', track, seconds]); },
    };
    const skeleton = { setToSetupPose() {}, updateWorldTransform() {} };
    const fromNode = {
        id: 401, nodeType: 'spine', sourceFile: 'hero.json', _trackMode: true,
        _trackSequence: [
            { enabled: true, loopSeq: false, animations: [{ name: 'idle', mixOut: 0 }] },
            { enabled: true, loopSeq: false, animations: [{ name: 'fx', mixOut: 0 }] },
        ],
        animations, skeletonData,
    };
    const toNode = {
        id: 402, nodeType: 'spine', sourceFile: 'hero.json', _trackMode: true,
        _trackSequence: [
            { enabled: true, loopSeq: false, animations: [{ name: 'walk', mixOut: 0 }] },
            { enabled: true, loopSeq: false, animations: [{ name: 'aim', mixOut: 0 }] },
        ],
        animations, skeletonData,
    };
    SMData.nodes = new Map([[401, fromNode], [402, toNode]]);
    SMData.connections = [{ id: 403, fromNode: 401, toNode: 402, _mixDuration: 0.3 }];
    const fromEntry = { _chainNodeId: 401, state: {}, skeleton: {}, _trackMode: true };
    const toEntry = {
        _chainNodeId: 402, state, skeleton, _trackMode: true,
        _skeletonData: skeletonData, skeletonData, animations, useVer: '4.2', physParam: null,
    };

    assert.equal(SMTool._prepareLayerConnectionMix(fromEntry, toEntry), true);
    assert.ok(calls.some((call) => call.join('|') === 'mix|idle|walk|0.3'));
    assert.ok(calls.some((call) => call.join('|') === 'mix|fx|aim|0.3'));
    assert.equal(current[0].mixDuration, 0.3);
    assert.equal(current[1].mixDuration, 0.3);
}

function testTrackSourceKeepsRealMixingFromForNormalAndTrackTargets() {
    const animations = [animation('idle', 1), animation('fx', 0.8), animation('walk', 1.2), animation('aim', 0.9)];
    const skeletonData = {
        animations,
        findAnimation(name) { return animations.find((item) => item.name === name) || null; },
    };
    const current = {};
    const emptyCalls = [];
    const stateData = { setMix() {} };
    const state = {
        data: stateData,
        clearTracks() { Object.keys(current).forEach((key) => delete current[key]); },
        getCurrent(track) { return current[track] || null; },
        setAnimation(track, name, loop) {
            const entry = {
                animation: skeletonData.findAnimation(name),
                trackTime: 0,
                timeScale: 1,
                loop,
                mixingFrom: current[track] || null,
            };
            current[track] = entry;
            return entry;
        },
        addAnimation() { throw new Error('final-pose priming must not rebuild and exhaust the source queue'); },
        setEmptyAnimation(track, seconds) { emptyCalls.push([track, seconds]); },
        update() {},
        apply() {},
    };
    const skeleton = { setToSetupPose() {}, updateWorldTransform() {} };
    const sourceTrackNode = {
        id: 451,
        nodeType: 'spine',
        sourceFile: 'hero.json',
        _trackMode: true,
        animations,
        _trackSequence: [
            { enabled: true, loopSeq: false, animations: [{ name: 'idle', mixOut: 0 }] },
            { enabled: true, loopSeq: false, animations: [{ name: 'fx', mixOut: 0 }] },
        ],
    };
    const normalTarget = {
        id: 452,
        nodeType: 'spine',
        sourceFile: 'hero.json',
        _trackMode: false,
        animations,
        currentAnim: 'walk',
    };
    const trackTarget = {
        id: 453,
        nodeType: 'spine',
        sourceFile: 'hero.json',
        _trackMode: true,
        animations,
        _trackSequence: [
            { enabled: true, loopSeq: false, animations: [{ name: 'walk', mixOut: 0 }] },
            { enabled: true, loopSeq: false, animations: [{ name: 'aim', mixOut: 0 }] },
        ],
    };
    const owner = { _skeletonData: skeletonData, skeletonData, animations };

    assert.equal(SMTool._primeStateWithNodeFinalPose(state, skeleton, skeletonData, sourceTrackNode, '4.2'), true);
    assert.equal(current[0].animation.name, 'idle');
    assert.equal(current[0].trackTime, 1);
    assert.equal(current[0].timeScale, 0);
    assert.equal(current[1].animation.name, 'fx');
    assert.equal(SMTool._transitionStateToNode(owner, state, skeleton, skeletonData, normalTarget, '4.2', 0.35), true);
    assert.equal(current[0].animation.name, 'walk');
    assert.equal(current[0].mixingFrom.animation.name, 'idle');
    assert.equal(current[0].mixDuration, 0.35);
    assert.deepEqual(emptyCalls, [[1, 0.35]]);

    assert.equal(SMTool._primeStateWithNodeFinalPose(state, skeleton, skeletonData, sourceTrackNode, '4.2'), true);
    assert.equal(SMTool._transitionStateToNode(owner, state, skeleton, skeletonData, trackTarget, '4.2', 0.45), true);
    assert.equal(current[0].animation.name, 'walk');
    assert.equal(current[0].mixingFrom.animation.name, 'idle');
    assert.equal(current[0].mixDuration, 0.45);
    assert.equal(current[1].animation.name, 'aim');
    assert.equal(current[1].mixingFrom.animation.name, 'fx');
    assert.equal(current[1].mixDuration, 0.45);
}

function testPreviewPrimesCompletedTrackSourceBeforeTransition() {
    const calls = [];
    const oldPrime = SMTool._primeStateWithNodeFinalPose;
    const oldTransition = SMTool._transitionStateToNode;
    const oldRestoreGuard = SMTool._restoreTrackMixSlotGuard;
    SMTool._restoreTrackMixSlotGuard = () => calls.push('restore-guard');
    SMTool._primeStateWithNodeFinalPose = () => { calls.push('prime-source-final-entries'); return true; };
    SMTool._transitionStateToNode = () => { calls.push('transition-target'); return true; };
    const pp = {
        state: { update() {}, apply() {} },
        skeleton: { updateWorldTransform() {} },
        _skeletonData: {},
        _spineVer: '4.2',
        _physParam: null,
    };
    const fromTrack = { id: 461, _trackMode: true, _trackSequence: [{ enabled: true, animations: [{ name: 'idle' }] }] };
    const toNormal = { id: 462, _trackMode: false, currentAnim: 'walk' };

    assert.equal(SMTool._mixAnimPreviewToNode(pp, fromTrack, toNormal, 0.3), true);

    SMTool._primeStateWithNodeFinalPose = oldPrime;
    SMTool._transitionStateToNode = oldTransition;
    SMTool._restoreTrackMixSlotGuard = oldRestoreGuard;
    assert.deepEqual(calls, ['restore-guard', 'prime-source-final-entries', 'transition-target']);
}

function testNormalToTrackFadesInTargetTracksWithoutSourceEntries() {
    const animations = [animation('idle', 1), animation('walk', 1.1), animation('aim', 0.7)];
    const skeletonData = {
        animations,
        findAnimation(name) { return animations.find((item) => item.name === name) || null; },
    };
    const current = {};
    const emptyCalls = [];
    const state = {
        data: { setMix() {} },
        clearTracks() { Object.keys(current).forEach((key) => delete current[key]); },
        getCurrent(track) { return current[track] || null; },
        setEmptyAnimation(track, seconds) {
            const entry = { animation: null, isEmpty: true, trackTime: 0, timeScale: 1 };
            current[track] = entry;
            emptyCalls.push([track, seconds]);
            return entry;
        },
        setAnimation(track, name, loop) {
            const entry = {
                animation: skeletonData.findAnimation(name),
                loop,
                mixingFrom: current[track] || null,
                trackTime: 0,
            };
            current[track] = entry;
            return entry;
        },
        addAnimation() { throw new Error('single-entry target tracks must not queue another item'); },
        update() {},
        apply() {},
    };
    const skeleton = { setToSetupPose() {}, updateWorldTransform() {} };
    const normalSource = {
        id: 471,
        _trackMode: false,
        currentAnim: 'idle',
        animations,
    };
    const trackTarget = {
        id: 472,
        _trackMode: true,
        animations,
        _trackSequence: [
            { enabled: true, loopSeq: false, animations: [{ name: 'walk', mixOut: 0 }] },
            { enabled: true, loopSeq: false, animations: [{ name: 'aim', mixOut: 0 }] },
        ],
    };
    const owner = { _skeletonData: skeletonData, skeletonData, animations };

    assert.equal(SMTool._primeStateWithNodeFinalPose(state, skeleton, skeletonData, normalSource, '4.2'), true);
    assert.equal(SMTool._transitionStateToNode(owner, state, skeleton, skeletonData, trackTarget, '4.2', 0.5), true);
    assert.equal(current[0].animation.name, 'walk');
    assert.equal(current[0].mixingFrom.animation.name, 'idle');
    assert.equal(current[0].mixDuration, 0.5);
    assert.equal(current[1].animation.name, 'aim');
    assert.equal(current[1].mixingFrom.isEmpty, true);
    assert.equal(current[1].mixDuration, 0.5);
    assert.deepEqual(emptyCalls, [[1, 0]]);
}

function testPreviewAlsoPrimesNormalSourceBeforeTrackTransition() {
    const calls = [];
    const oldPrime = SMTool._primeStateWithNodeFinalPose;
    const oldTransition = SMTool._transitionStateToNode;
    SMTool._primeStateWithNodeFinalPose = () => { calls.push('prime-normal-final-entry'); return true; };
    SMTool._transitionStateToNode = () => { calls.push('transition-track-target'); return true; };
    const pp = {
        state: { update() {}, apply() {} },
        skeleton: { updateWorldTransform() {} },
        _skeletonData: {},
        _spineVer: '4.2',
        _physParam: null,
    };
    const fromNormal = { id: 481, _trackMode: false, currentAnim: 'idle' };
    const toTrack = { id: 482, _trackMode: true, _trackSequence: [{ enabled: true, animations: [{ name: 'walk' }] }] };

    assert.equal(SMTool._mixAnimPreviewToNode(pp, fromNormal, toTrack, 0.4), true);

    SMTool._primeStateWithNodeFinalPose = oldPrime;
    SMTool._transitionStateToNode = oldTransition;
    assert.deepEqual(calls, ['prime-normal-final-entry', 'transition-track-target']);
}

function testTrackGlobalLoopToggleRebuildsRealSequences() {
    const node = {
        id: 491,
        nodeType: 'spine',
        loop: true,
        state: {},
        _trackMode: true,
        _trackSequence: [
            { enabled: true, loopSeq: true, animations: [{ name: 'idle' }] },
            { enabled: true, loopSeq: true, animations: [{ name: 'fx' }] },
        ],
        tracks: [{ animName: 'legacy', loop: true }],
    };
    SMData.nodes = new Map([[491, node]]);
    const oldDocument = context.document;
    const oldRestart = SMTool._restartNodePlaybackAtZero;
    const oldLegacy = SMTool._applyTracksToState;
    const oldRefresh = SMTool._refreshTrackPanel;
    const oldPreviewInit = SMTool._initAnimPreview;
    const calls = [];
    context.document = { querySelector: () => null, getElementById: () => null };
    SMTool._restartNodePlaybackAtZero = () => { calls.push('track-sequence'); return true; };
    SMTool._applyTracksToState = () => calls.push('legacy-tracks');
    SMTool._refreshTrackPanel = () => calls.push('refresh-panel');
    SMTool._initAnimPreview = () => calls.push('preview');
    SMData._animPreview = { visible: true, nodeId: 491, _layerSkeletons: null };

    SMTool._toggleLoop(491);

    context.document = oldDocument;
    SMTool._restartNodePlaybackAtZero = oldRestart;
    SMTool._applyTracksToState = oldLegacy;
    SMTool._refreshTrackPanel = oldRefresh;
    SMTool._initAnimPreview = oldPreviewInit;
    assert.equal(node.loop, false);
    assert.equal(node._trackSequence[0].loopSeq, false);
    assert.equal(node._trackSequence[1].loopSeq, false);
    assert.deepEqual(calls, ['track-sequence', 'refresh-panel', 'preview']);
}

function testPreviewConsumesExactSourceFrameDelta() {
    const oldFrameId = SMTool._renderFrameId;
    const updates = [];
    const source = {
        state: {
            update(dt) { updates.push(dt); },
            apply() {},
        },
        skeleton: { updateWorldTransform() {} },
        _lastStateAdvanceFrameId: 77,
        _lastStateAdvanceDt: 0.033,
        _trackMode: false,
    };
    SMTool._renderFrameId = 77;
    assert.equal(SMTool._getSynchronizedPreviewDt({}, source, 0.02), 0.033);
    assert.deepEqual(updates, []);

    SMTool._renderFrameId = 78;
    assert.equal(SMTool._getSynchronizedPreviewDt({}, source, 0.02), 0.02);
    assert.deepEqual(updates, [0.02]);
    assert.equal(source._lastStateAdvanceFrameId, 78);
    assert.equal(source._lastStateAdvanceDt, 0.02);
    SMTool._renderFrameId = oldFrameId;
}

function testSinglePreviewRestartAlsoRewindsCanvasNode() {
    const oldRestartNode = SMTool._restartNodePlaybackAtZero;
    const oldApplyPreview = SMTool._applyPreviewTrackSequence;
    const oldRenderPreview = SMTool._renderAnimPreview;
    const calls = [];
    SMTool._restartNodePlaybackAtZero = () => { calls.push('canvas-zero'); return true; };
    SMTool._applyPreviewTrackSequence = () => calls.push('preview-zero');
    SMTool._renderAnimPreview = () => calls.push('render-zero');
    const pp = {
        state: { getCurrent: () => null, update() {}, apply() {} },
        skeleton: { setToSetupPose() {}, updateWorldTransform() {} },
        _skeletonData: {},
        _playbackOwner: { type: 'single', nodeId: 501 },
        _spineVer: '4.2',
        _flowFrozen: false,
    };
    const source = {
        id: 501,
        state: {},
        _trackMode: true,
        _trackSequence: [{ enabled: true, animations: [{ name: 'idle' }] }],
        currentAnim: 'idle',
    };

    SMTool._restartAnimPreviewStateAtZero(pp, source);

    SMTool._restartNodePlaybackAtZero = oldRestartNode;
    SMTool._applyPreviewTrackSequence = oldApplyPreview;
    SMTool._renderAnimPreview = oldRenderPreview;
    assert.deepEqual(calls, ['canvas-zero', 'preview-zero', 'render-zero']);
}

function testLayerEyeOnlyUpdatesItsOwnThumbnail() {
    const oldDocument = context.document;
    const oldUpdater = SMTool._updateLayerListThumbnails;
    const updates = [];
    const classChanges = [];
    const button = { classList: { toggle(name, enabled) { classChanges.push(['button', name, enabled]); } }, title: '' };
    const item = {
        classList: { toggle(name, enabled) { classChanges.push(['item', name, enabled]); } },
        querySelector() { return button; },
    };
    context.document = { querySelector(selector) { return selector.includes('data-layer-idx="1"') ? item : null; } };
    SMTool._updateLayerListThumbnails = (now, force, idx) => updates.push([force, idx]);
    SMData._animPreview = { _layerSkeletons: [{ _hidden: false }, { _hidden: false }, { _hidden: false }] };

    SMTool._toggleLayerVisibility(1);

    context.document = oldDocument;
    SMTool._updateLayerListThumbnails = oldUpdater;
    assert.equal(SMData._animPreview._layerSkeletons[1]._hidden, true);
    assert.equal(SMData._animPreview._layerSkeletons[0]._hidden, false);
    assert.equal(SMData._animPreview._layerSkeletons[2]._hidden, false);
    assert.deepEqual(updates, [[true, 1]]);
    assert.ok(classChanges.some((entry) => entry.join('|') === 'item|hidden-layer|true'));
}

function testClosedFullFlowCarriesClosingEdgeMixBackToSource() {
    const path = {
        nodes: [
            { id: 501, anim: 'idle' },
            { id: 502, anim: 'walk' },
            { id: 503, anim: 'run' },
            { id: 501, anim: 'idle', cycleClose: true },
        ],
        conns: [601, 602, 603],
    };
    SMData.connections = [
        { id: 601, fromNode: 501, toNode: 502, _mixDuration: 0.1 },
        { id: 602, fromNode: 502, toNode: 503, _mixDuration: 0.2 },
        { id: 603, fromNode: 503, toNode: 501, _mixDuration: 0.4 },
    ];
    assert.equal(JSON.stringify(SMTool._getClosedFlowCycleTransition(path)), JSON.stringify({
        fromNodeId: 503,
        toNodeId: 501,
        mixDurationSeconds: 0.4,
    }));

    const restartCalls = [];
    const oldRestart = SMTool._restartFullPlaybackFromStart;
    SMTool._restartFullPlaybackFromStart = (options) => { restartCalls.push(options); return true; };
    assert.equal(SMTool._restartFullPlaybackFromCycle(path), true);
    SMTool._restartFullPlaybackFromStart = oldRestart;
    assert.equal(restartCalls[0].cycleTransition.mixDurationSeconds, 0.4);

    const oldDocument = context.document;
    const oldApply = SMTool._applyStepToMainNode;
    const oldShow = SMTool._showAnimPreview;
    const oldUpdatePanel = SMTool._updateFullFlowPanel;
    const oldFocus = SMTool._setFullComponentFocus;
    const oldUpdateSel = SMTool._updateSel;
    const oldUpdateColors = SMTool._updateStateRowColors;
    const oldClearBars = SMTool._clearAllProgressBars;
    const owners = [];
    const sourceNode = {
        id: 501,
        nodeType: 'spine',
        skeletonData: { animations: [{ name: 'idle', duration: 1 }] },
        _playbackSpeed: 1,
    };
    SMData.nodes = new Map([[501, sourceNode]]);
    SMData._fullPaths = [path];
    SMData._fullPlayback = {
        activePathIdx: 0,
        currentStep: 0,
        isPlaying: true,
        _cycleTransition: { fromNodeId: 503, toNodeId: 501, mixDurationSeconds: 0.4 },
    };
    SMData._animPreview = { visible: true, nodeId: 503, _flowFrozen: false };
    context.document = { getElementById: () => null, querySelector: () => null };
    SMTool._applyStepToMainNode = () => sourceNode;
    SMTool._showAnimPreview = (node, restartAtZero, owner) => owners.push({ node, restartAtZero, owner });
    SMTool._updateFullFlowPanel = () => {};
    SMTool._setFullComponentFocus = () => {};
    SMTool._updateSel = () => {};
    SMTool._updateStateRowColors = () => {};
    SMTool._clearAllProgressBars = () => {};

    SMTool._playFullStep();

    context.document = oldDocument;
    SMTool._applyStepToMainNode = oldApply;
    SMTool._showAnimPreview = oldShow;
    SMTool._updateFullFlowPanel = oldUpdatePanel;
    SMTool._setFullComponentFocus = oldFocus;
    SMTool._updateSel = oldUpdateSel;
    SMTool._updateStateRowColors = oldUpdateColors;
    SMTool._clearAllProgressBars = oldClearBars;
    assert.equal(owners.length, 1);
    assert.equal(owners[0].restartAtZero, true);
    assert.equal(owners[0].owner.mixDurationSeconds, 0.4);
    assert.equal(owners[0].owner.cycleFromNodeId, 503);
    assert.equal(SMData._fullPlayback._cycleTransition, null);
}

function testDirectSuccessorFocusAndRevisionAreImmediate() {
    SMData.nodes = new Map([
        [701, { id: 701 }],
        [702, { id: 702 }],
        [703, { id: 703 }],
        [704, { id: 704 }],
    ]);
    SMData.connections = [
        { id: 801, fromNode: 701, toNode: 702 },
        { id: 802, fromNode: 703, toNode: 701 },
        { id: 803, fromNode: 702, toNode: 704 },
    ];
    SMData.selectedNodes = new Set([703]);
    SMData.selectedNode = 703;
    SMData.selectedConnection = 802;
    SMData._lastFocusSignature = '';
    SMData._focusRevision = 4;
    SMData._forceRedraw = false;

    const focus = SMTool._focusDirectSuccessors(701);
    assert.deepEqual(Array.from(focus.nodeIds).sort(), [701, 702]);
    assert.deepEqual(Array.from(focus.connIds), [801]);
    assert.deepEqual(Array.from(SMData.selectedNodes), [701]);
    assert.equal(SMData.selectedNode, 701);
    assert.equal(SMData.selectedConnection, null);

    assert.equal(SMTool._commitFocusRevision(focus.nodeIds), true);
    assert.equal(SMData._focusRevision, 5);
    assert.equal(SMData._forceRedraw, true);
    SMData._forceRedraw = false;
    assert.equal(SMTool._commitFocusRevision(focus.nodeIds), false);
    assert.equal(SMData._focusRevision, 5);
    assert.equal(SMData._forceRedraw, false);

    SMData._flowFocus = { nodeIds: new Set([701, 703]), connIds: new Set([802]) };
    assert.equal(SMTool._commitFocusRevision(SMData._flowFocus.nodeIds), true);
    assert.equal(SMData._focusRevision, 6);
    assert.equal(SMData._forceRedraw, true);
}

function testRightClickCancelsConnectingWithoutOpeningContextMenu() {
    const oldDocument = context.document;
    const oldGrid = SMTool.gridCanvas;
    const oldUpdateSel = SMTool._updateSel;
    const oldUpdateColors = SMTool._updateStateRowColors;
    const classCalls = [];
    const menu = { style: { display: 'block' } };
    const button = { classList: { remove(value) { classCalls.push(value); } } };
    context.document = {
        getElementById(id) {
            if (id === 'btnConnect') return button;
            if (id === 'ctxMenu') return menu;
            return null;
        },
    };
    SMTool.gridCanvas = { style: { cursor: 'crosshair' } };
    let selectionRefreshes = 0;
    let colorRefreshes = 0;
    SMTool._updateSel = () => { selectionRefreshes++; };
    SMTool._updateStateRowColors = () => { colorRefreshes++; };
    SMData.connectMode = true;
    SMData.connecting = { nodeId: 701 };
    SMData._forceRedraw = false;

    assert.equal(SMTool._cancelConnectModeForContextMenu(), true);
    assert.equal(SMData.connectMode, false);
    assert.equal(SMData.connecting, null);
    assert.equal(menu.style.display, 'none');
    assert.equal(SMTool.gridCanvas.style.cursor, 'default');
    assert.equal(SMData._forceRedraw, true);
    assert.ok(SMData._suppressContextMenuUntil >= Date.now());
    assert.deepEqual(classCalls, ['active']);
    assert.equal(selectionRefreshes, 1);
    assert.equal(colorRefreshes, 1);
    assert.equal(SMTool._cancelConnectModeForContextMenu(), false);

    context.document = oldDocument;
    SMTool.gridCanvas = oldGrid;
    SMTool._updateSel = oldUpdateSel;
    SMTool._updateStateRowColors = oldUpdateColors;
}

function testConnectorWorldPositionCacheAvoidsRepeatedLayoutReads() {
    const oldGetEl = SMTool._getEl;
    const oldCanvasToWorld = SMTool.canvasToWorld;
    const oldCache = SMTool._connectorLocalCache;
    let layoutReads = 0;
    const dot = {
        getBoundingClientRect() {
            layoutReads++;
            return { left: 90, top: 180, width: 20, height: 40 };
        },
    };
    const bar = { querySelector: () => dot };
    const root = { querySelector: () => bar, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
    SMTool._getEl = () => root;
    SMTool.canvasToWorld = (x, y) => ({ x, y });
    SMTool._connectorLocalCache = {};
    const node = { id: 901, nodeType: 'spine', currentAnim: 'idle', x: 10, y: 20, _customScale: 1 };

    assert.equal(JSON.stringify(SMTool._getStateConnectorPos(node, 'idle', 'output')), JSON.stringify({ x: 100, y: 200 }));
    node.x = 40;
    node.y = 50;
    assert.equal(JSON.stringify(SMTool._getStateConnectorPos(node, 'idle', 'output')), JSON.stringify({ x: 130, y: 230 }));
    assert.equal(layoutReads, 1);
    SMTool._invalidateConnectorLayout(node);
    SMTool._getStateConnectorPos(node, 'idle', 'output');
    assert.equal(layoutReads, 2);

    // 层级节点行布局会在后台刷新，输入/分层输出都必须实时测量，不能命中旧缓存。
    const layerRoot = {
        querySelector(selector) {
            if (selector.indexOf('.layer-dot') === 0) return dot;
            return bar;
        },
        getBoundingClientRect: root.getBoundingClientRect,
    };
    SMTool._getEl = () => layerRoot;
    SMTool._connectorLocalCache = {};
    layoutReads = 0;
    const layerNode = { id: 902, nodeType: 'layer', x: 10, y: 20, _customScale: 1 };
    SMTool._getStateConnectorPos(layerNode, 'layer_1', 'output');
    SMTool._getStateConnectorPos(layerNode, 'layer_1', 'output');
    assert.equal(layoutReads, 2);

    SMTool._getEl = oldGetEl;
    SMTool.canvasToWorld = oldCanvasToWorld;
    SMTool._connectorLocalCache = oldCache;
}

function testControlPointHitTestOnlyScansVisibleActiveConnection() {
    const oldGetPos = SMTool._getStateConnectorPos;
    const oldWorldToCanvas = SMTool.worldToCanvas;
    SMData.nodes = new Map();
    SMData.connections = [];
    for (let i = 0; i < 100; i++) {
        SMData.nodes.set(i * 2 + 1, { id: i * 2 + 1 });
        SMData.nodes.set(i * 2 + 2, { id: i * 2 + 2 });
        SMData.connections.push({ id: 1000 + i, fromNode: i * 2 + 1, toNode: i * 2 + 2, cp1x: 10, cp1y: 0, cp2x: -10, cp2y: 0 });
    }
    let endpointReads = 0;
    SMTool._getStateConnectorPos = (node, state, type) => {
        endpointReads++;
        return type === 'output' ? { x: 0, y: 0 } : { x: 100, y: 0 };
    };
    SMTool.worldToCanvas = (x, y) => ({ x, y });
    SMData.view.zoom = 1;
    SMData.selectedConnection = 1099;
    SMData.draggingCP = null;
    SMTool._findCP(10, 0, 24);
    assert.equal(endpointReads, 2);

    endpointReads = 0;
    SMData.selectedConnection = null;
    assert.equal(SMTool._findCP(10, 0, 24), null);
    assert.equal(endpointReads, 0);

    SMTool._getStateConnectorPos = oldGetPos;
    SMTool.worldToCanvas = oldWorldToCanvas;
}

function testFlowGraphSignatureIgnoresNodePositionButTracksRealDataChanges() {
    SMData.nodes = new Map([
        [1, { id: 1, nodeType: 'spine', currentAnim: 'idle', name: 'A', x: 10, y: 20 }],
        [2, { id: 2, nodeType: 'spine', currentAnim: 'walk', name: 'B', x: 30, y: 40 }],
    ]);
    SMData.connections = [{ id: 1, fromNode: 1, fromState: 'idle', toNode: 2, toState: 'walk', condition: '', _mixDuration: 0 }];
    const beforeMove = SMTool._flowGraphSignature();
    SMData.nodes.get(1).x = 9999;
    SMData.nodes.get(1).y = -8888;
    assert.equal(SMTool._flowGraphSignature(), beforeMove);
    SMData.connections[0].condition = 'speed > 1';
    assert.notEqual(SMTool._flowGraphSignature(), beforeMove);
}

function testFullFlowBranchesUseEachTargetNodesRealAnimation() {
    SMData.nodes = new Map([
        [1, { id: 1, nodeType: 'spine', name: 'A', currentAnim: 'A' }],
        [2, { id: 2, nodeType: 'spine', name: 'B', currentAnim: 'shared-preview' }],
        [3, { id: 3, nodeType: 'spine', name: 'C', currentAnim: 'shared-preview' }],
        [4, { id: 4, nodeType: 'spine', name: 'D', currentAnim: 'shared-preview' }],
        [5, { id: 5, nodeType: 'spine', name: 'F', currentAnim: 'shared-preview' }],
    ]);
    SMData.connections = [2, 3, 4, 5].map((targetId, index) => ({
        id: index + 1,
        fromNode: 1,
        fromState: 'A',
        toNode: targetId,
        toState: ['B', 'C', 'D', 'F'][index],
    }));
    const paths = [2, 3, 4, 5].map((targetId) => ({
        nodes: [{ id: 1, anim: 'A' }, { id: targetId, anim: 'B' }],
        conns: [targetId - 1],
    }));

    SMTool._normalizeFullFlowPathSteps(paths);
    assert.deepEqual(paths.map((flowPath) => flowPath.nodes.map((step) => `${step.id}:${step.anim}`).join('>')), [
        '1:A>2:B',
        '1:A>3:C',
        '1:A>4:D',
        '1:A>5:F',
    ]);

    SMData.connections[1].toState = 'C_changed';
    SMTool._normalizeFullFlowPathSteps(paths);
    assert.equal(paths[1].nodes[1].anim, 'C_changed', 'cached paths must refresh from their own incoming connection');

    SMData.connections[1].toState = 'C';
    const enumerated = SMTool._enumerateSimpleFullFlowPaths(1);
    assert.equal(JSON.stringify(enumerated.map((flowPath) => flowPath.nodes[1].id)), JSON.stringify([2, 3, 4, 5]));
    assert.equal(JSON.stringify(enumerated.map((flowPath) => flowPath.nodes[1].anim)), JSON.stringify(['B', 'C', 'D', 'F']));

    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'js/ui-dom.js'), 'utf8');
    assert.match(appSource, /var simplePaths = SMTool\._enumerateSimpleFullFlowPaths\(sourceId\)/);
    assert.match(appSource, /return SMTool\._normalizeFullFlowPathSteps\(SMData\._fullPathTopologyCache\.get\(cacheKey\)\)/);
    assert.match(appSource, /SMTool\._normalizeFullFlowPathSteps\(paths\);[\s\S]{0,200}SMTool\._sortFullFlowPathsRoundRobin\(paths\);[\s\S]{0,120}SMData\._fullPathTopologyCache\.set/);
    assert.match(uiSource, /_connectionById\[indexedConnection\.id\] = indexedConnection/);
    assert.match(uiSource, /_renderTransitionEditor\(_pathTransitionConnection\(path, si\)\)/);
    assert.match(uiSource, /var incomingStepConnection = si > 0 \? _pathTransitionConnection\(path, si - 1\) : null/);
    assert.match(uiSource, /_disp\(renderedStepAnim, SMData\.nodes\.get\(sn\.id\)\)/);
}

function testPreviewAnimationChangeDoesNotCollapseEnumeratedConnectionStates() {
    SMData.nodes = new Map([
        [1, { id: 1, nodeType: 'spine', name: 'hoverborad', currentAnim: 'hoverborad' }],
        [2, { id: 2, nodeType: 'spine', name: 'shared-target', currentAnim: 'preview-only' }],
    ]);
    SMData.connections = ['B', 'C', 'D', 'F'].map((toState, index) => ({
        id: index + 1,
        fromNode: 1,
        fromState: 'hoverborad',
        toNode: 2,
        toState,
    }));

    const before = SMData.connections.map((connection) => connection.toState);
    SMData.nodes.get(2).currentAnim = 'F';
    SMTool._syncFlowPathAnim(2, 'F');
    assert.deepEqual(
        SMData.connections.map((connection) => connection.toState),
        before,
        'changing the node preview must preserve every authored connection state'
    );

    const enumerated = SMTool._enumerateSimpleFullFlowPaths(1);
    assert.equal(
        JSON.stringify(enumerated.map((flowPath) => flowPath.nodes[1].anim)),
        JSON.stringify(['B', 'C', 'D', 'F']),
        'parallel connections to the same node must remain independent enum paths'
    );
    assert.equal(new Set(enumerated.map((flowPath) => SMTool._fullPathStableKey(flowPath))).size, 4);
}

function testDragSnapUsesCachedNodeSizesWithoutLayoutReads() {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const interactionSource = fs.readFileSync(path.join(root, 'js/interaction.js'), 'utf8');
    const rectStart = appSource.indexOf('SMTool._getNodeWorldRect = function');
    const rectEnd = appSource.indexOf('SMTool._scheduleNodeRectCacheWarmup = function', rectStart);
    const rectSource = appSource.slice(rectStart, rectEnd);
    assert.match(rectSource, /SMTool\._nodeWorldSizeCache/);
    assert.match(rectSource, /options && options\.avoidLayout/);
    assert.match(appSource, /拖拽和流程播放期间绝不执行测量/);
    assert.match(interactionSource, /_getNodeWorldRect\(draggedNodesM\[i\], \{ avoidLayout: true \}\)/);
    assert.match(interactionSource, /_getNodeWorldRect\(n, \{ avoidLayout: true \}\)/);
}

function testFlowListsRenderPriorityItemsBeforeIdleHydration() {
    const uiSource = fs.readFileSync(path.join(root, 'js/ui-dom.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
    assert.match(uiSource, /\[LOCK-PERF-1\] 实时核心与大列表展示必须永久解耦/);
    assert.match(uiSource, /仅用户明确说出「解锁 LOCK-PERF-1」/);
    assert.match(appSource, /\[LOCK-PERF-1\] 首屏先响应/);
    assert.match(appSource, /\[LOCK-PERF-1\] 获取节点在世界空间中的矩形/);
    assert.match(uiSource, /initialCount = Math\.min\(paths\.length/);
    assert.match(uiSource, /activePathIdx >= initialCount/);
    assert.match(uiSource, /_queueFullPathHydration\(80\)/);
    assert.match(uiSource, /batchCount < 1/);
    assert.match(uiSource, /initialThreeCount = Math\.min\(chainTasks\.length/);
    assert.match(uiSource, /_queueThreeHydration\(80\)/);
    assert.match(uiSource, /SMData\._fullPlayback && SMData\._fullPlayback\.isPlaying/);
    assert.match(cssSource, /\.flp-full-list\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
}

function testThreeFlowConditionEditMapsDirectlyToCanvasConnection() {
    const oldDocument = context.document;
    const oldPushUndo = SMTool.pushUndo;
    const oldPassiveKey = SMTool._flowPanelPassiveKey;
    const uiSource = fs.readFileSync(path.join(root, 'js/ui-dom.js'), 'utf8');
    const interactionSource = fs.readFileSync(path.join(root, 'js/interaction.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
    const fields = [0, 1].map(() => {
        const classes = new Set(['flp-condition', 'editing']);
        return {
            contentEditable: 'true',
            textContent: '',
            title: '',
            classList: {
                remove(name) { classes.delete(name); },
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
                contains(name) { return classes.has(name); },
            },
            classes,
        };
    });
    context.document = { querySelectorAll: () => fields };
    let undoCount = 0;
    SMTool.pushUndo = () => { undoCount++; };
    SMTool._flowPanelPassiveKey = () => 'condition-key';
    SMData.connections = [{ id: 77, condition: 'old', _hideLabel: true }];
    SMData._forceRedraw = false;

    assert.equal(SMTool._commitThreeFlowCondition(77, '  speed > 2  '), 'speed > 2');
    assert.equal(SMData.connections[0].condition, 'speed > 2');
    assert.equal(SMData.connections[0]._hideLabel, false);
    assert.equal(SMData._forceRedraw, true);
    assert.equal(SMData._lastPassiveFlowPanelKey, 'condition-key');
    assert.equal(undoCount, 1);
    for (const field of fields) {
        assert.equal(field.textContent, '条件：speed > 2');
        assert.equal(field.contentEditable, 'false');
        assert.equal(field.classes.has('flp-condition'), true);
        assert.equal(field.classes.has('flp-condition-empty'), false);
    }
    SMTool._commitThreeFlowCondition(77, 'speed > 2');
    assert.equal(undoCount, 1, 'unchanged condition must not add an undo snapshot');

    assert.match(uiSource, /data-flow-condition-conn=/);
    assert.match(interactionSource, /addEventListener\('dblclick'/);
    assert.match(interactionSource, /var onBlur = function \(\) \{ finish\(false\); \}/);
    assert.match(interactionSource, /keyEvent\.key === 'Enter'/);
    assert.match(cssSource, /\[data-flow-condition-conn\]\.editing/);

    context.document = oldDocument;
    SMTool.pushUndo = oldPushUndo;
    SMTool._flowPanelPassiveKey = oldPassiveKey;
}

const tests = [
    testTrackDurationUsesRealOverlapAndLongestParallelTrack,
    testNativeQueueMixStartsBeforePreviousAnimationEnds,
    testSwitchBackToNormalModeClearsTrackPoseBeforeReapply,
    testPlaybackTreeUsesPathLocalCycleDetection,
    testHiddenLayerStillAdvancesToBarrier,
    testLoopResetRewindsRuntimeState,
    testParallelLayerDoesNotOverwriteItsFirstChainNodeWhileRenderingLaterNodes,
    testCountLoopBranchStopsOnRealFinalFrameBeforeBarrier,
    testParallelCycleRestartRewindsEveryLayerInOneBatch,
    testPreviewControlAndFlowRestartSourceOrder,
    testPreviewRestartPrioritizesWholeActiveFlow,
    testFiniteTrackPassNeverPrequeuesAnUnauthorizedNextCycle,
    testPreviewRestartDispatchesByExplicitOwnerNotStaleSelectedFlow,
    testPreviewAttachmentsLayerThumbnailsAndCanvasPerformanceContracts,
    testParallelBarrierCommitsOnlyOncePerCycle,
    testFullPlaybackUnifiedClockAdvancesAndRestartsAtomically,
    testRapidPauseClicksToggleFlowWithoutRestartingIt,
    testResumingLogicalFlowStepKeepsPrimedPreviewFrozen,
    testLogicalFlowSourcePrimesFirstRenderableFrameZero,
    testSameSourceFlowStepForcesExactPreviewFrameZero,
    testBundledSpineFixtureIsComplete,
    testBundledProjectZipParsesWithApplicationImporter,
    testAIExportV3PreservesGraphAndTrackSemanticsWithoutMutation,
    testConnectionMixUsesNativeSpineTransitionInParallelChain,
    testTrackRenamePropagatesConnectionPorts,
    testTrackNodesUseConnectionMixOnEveryActiveTrack,
    testTrackSourceKeepsRealMixingFromForNormalAndTrackTargets,
    testPreviewPrimesCompletedTrackSourceBeforeTransition,
    testNormalToTrackFadesInTargetTracksWithoutSourceEntries,
    testPreviewAlsoPrimesNormalSourceBeforeTrackTransition,
    testTrackGlobalLoopToggleRebuildsRealSequences,
    testPreviewConsumesExactSourceFrameDelta,
    testSinglePreviewRestartAlsoRewindsCanvasNode,
    testLayerEyeOnlyUpdatesItsOwnThumbnail,
    testClosedFullFlowCarriesClosingEdgeMixBackToSource,
    testDirectSuccessorFocusAndRevisionAreImmediate,
    testRightClickCancelsConnectingWithoutOpeningContextMenu,
    testConnectorWorldPositionCacheAvoidsRepeatedLayoutReads,
    testControlPointHitTestOnlyScansVisibleActiveConnection,
    testFlowGraphSignatureIgnoresNodePositionButTracksRealDataChanges,
    testFullFlowBranchesUseEachTargetNodesRealAnimation,
    testPreviewAnimationChangeDoesNotCollapseEnumeratedConnectionStates,
    testDragSnapUsesCachedNodeSizesWithoutLayoutReads,
    testFlowListsRenderPriorityItemsBeforeIdleHydration,
    testThreeFlowConditionEditMapsDirectlyToCanvasConnection,
];

for (const test of tests) {
    test();
    console.log(`✓ ${test.name}`);
}

console.log(`\n${tests.length} playback core tests passed.`);
