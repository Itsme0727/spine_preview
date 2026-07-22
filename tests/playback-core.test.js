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
    testAIExportV3PreservesGraphAndTrackSemanticsWithoutMutation,
];

for (const test of tests) {
    test();
    console.log(`✓ ${test.name}`);
}

console.log(`\n${tests.length} playback core tests passed.`);
