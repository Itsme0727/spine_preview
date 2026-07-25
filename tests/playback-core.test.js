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
load('js/layer-node-v2.js');
load('js/spine-loading.js');
load('js/spine-rendering.js');
load('js/ui-dom.js');
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

    SMTool._restartFullPlaybackFromStart = oldRestartFlow;
    SMTool._restartLayerPreviewCycle = oldRestartParallel;
    SMTool._restartAnimPreviewStateAtZero = oldRestartSingle;
    assert.deepEqual(calls, ['single', 'parallel', 'flow', 'flow']);
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
    assert.equal(result.gameProtocol.runtimeRules.noEligibleTransition, 'stop-current-flow-and-report');
    assert.equal(result.graph.nodes[0].runtimeTransform.authored, false);
    assert.equal(result.validation.status, 'valid-with-warnings');
    assert.equal(trackNode.tracks.length, 0, 'read-only AI export must not initialize legacy tracks');
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
    testParallelBarrierCommitsOnlyOncePerCycle,
    testFullPlaybackUnifiedClockAdvancesAndRestartsAtomically,
    testRapidPauseClicksToggleFlowWithoutRestartingIt,
    testResumingLogicalFlowStepKeepsPrimedPreviewFrozen,
    testLogicalFlowSourcePrimesFirstRenderableFrameZero,
    testSameSourceFlowStepForcesExactPreviewFrameZero,
    testBundledSpineFixtureIsComplete,
    testBundledProjectZipParsesWithApplicationImporter,
    testAIExportV3PreservesGraphAndTrackSemanticsWithoutMutation,
];

for (const test of tests) {
    test();
    console.log(`✓ ${test.name}`);
}

console.log(`\n${tests.length} playback core tests passed.`);
