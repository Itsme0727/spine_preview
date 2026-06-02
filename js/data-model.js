/* ================================================================
   数据模型 — 全局状态 & SpineNodeData 类
   整个应用共享 SMData 全局状态对象
   ================================================================ */

// ---- 连线颜色调色板 (高饱和艳色，高随机) ----
var CONN_COLORS = [
    '#ff3366', '#ff6600', '#ffaa00', '#ffdd00', '#aaff00', '#44ff00',
    '#00ff88', '#00ffcc', '#00ddff', '#00aaff', '#3366ff', '#6633ff',
    '#aa33ff', '#ff33cc', '#ff3388', '#ff4444', '#ff8800', '#ffe600',
    '#66ff33', '#00ff66', '#00eeff', '#2288ff', '#7744ff', '#ee33ff',
    '#ff5566', '#ff8833', '#ffcc00', '#88ff00', '#00ffaa', '#00ccff',
    '#5577ff', '#8844ff', '#cc33ff', '#ff44aa', '#ff5577', '#ff7722'
];

function _connColor(idx) {
    return CONN_COLORS[idx % CONN_COLORS.length];
}

// ---- 全局状态 ----
var SMData = {
    nodes: new Map(),
    connections: [],
    nextId: 1,
    nextConnId: 1,
    view: { x: 0, y: 0, zoom: 1 },
    connectMode: false,
    connecting: null,
    selectedNode: null,
    selectedNodes: new Set(),    // 多选集合
    selectedConnection: null,
    showGrid: true,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    isMultiDragging: false,      // 是否正在拖拽多个选中节点
    multiDragOffsets: new Map(), // 多拖拽时每个节点的偏移
    isPanning: false,
    panStart: { x: 0, y: 0 },
    viewStart: { x: 0, y: 0 },
    // 贝塞尔控制点拖拽
    draggingCP: null,
    hoveredCP: null,
    selectingCP: false,
    // 条件标签拖拽（拖拽标签改变贝塞尔曲线走势）
    draggingLabel: null,  // { connId, startCp1x, startCp1y, startCp2x, startCp2y, startMx, startMy }
    // 框选（marquee selection）
    marqueeActive: false,
    marqueeStart: { x: 0, y: 0 },
    marqueeEnd: { x: 0, y: 0 },
    // 翻译缓存
    _transCache: {},

    // 骨骼标签全局存储：{ "源文件名||动画名": { "骨骼名": "标签文本" } }
    _boneLabelStore: {},

    // 节点分组
    groups: [],          // [{ id, nodeIds: Set, color }]
    nextGroupId: 1,

    // 渲染模式：'perf' | 'dyn'
    renderMode: 'perf',

    // 底部动画组合浮窗面板状态
    _flowPanel: {
        pinned: false,
        hovered: false,
        expanded: false,
        maximized: false,
        _collapseTimer: null,
        _justUnmaximized: false
    },

    // 动画组合面板中点击高亮某条组合链的焦点
    _flowFocus: null,  // { nodeIds: Set, connIds: Set } 或 null

    // 动画组模式：'three' | 'full'
    flowMode: 'three',

    // 完整动画组：当前源节点的所有路径
    _fullPaths: [],    // [{ nodes: [{id, anim}], conns: [id] }]

    // 完整动画组播放状态
    _fullPlayback: {
        activePathIdx: -1,   // 当前播放的路径索引
        currentStep: 0,      // 当前播放到第几个节点
        isPlaying: false,
        _stepped: false,     // 是否手动导航过（prev/next）
        _timer: null
    }
};

// ---- Spine 节点数据类 ----
var SpineNodeData = (function () {
    function SpineNodeData(id) {
        this.id = id;
        this.name = 'Node_' + id;
        this.nodeType = 'spine';  // 'spine' | 'shortText' | 'textBox'
        this.x = Math.random() * 200 - 100 + window.innerWidth / 2;
        this.y = Math.random() * 200 - 100 + window.innerHeight / 2;
        this.width = 300;

        // 归属文件名
        this.sourceFile = '';

        // Spine 数据
        this.skeletonData = null;
        this.atlasData = null;
        this.textureImg = null;
        this.skeleton = null;
        this.state = null;
        this.animations = [];
        this.skins = [];
        this.slots = [];
        this.bones = [];
        this.version = '';
        this.currentAnim = '';
        this.currentSkin = '';
        this.premultipliedAlpha = false;

        // 原始源数据（用于导出/导入往返）
        this._srcSkelJson = null;
        this._srcSkelBinBase64 = null;
        this._srcAtlasText = '';
        this._srcTexDataUrl = '';
        this._srcType = '';
        this._srcFileNames = [];    // 原始文件名列表（含后缀）

        // WebGL 资源
        this.canvas = null;
        this.gl = null;
        this.shader = null;
        this.batcher = null;
        this.mvp = null;
        this.skeletonRenderer = null;
        this.glTextures = [];
        this.bounds = null;
        this.infoCollapsed = true;

        // 版本相关
        this._spineVer = '';
        this._SP = null;
        this._physParam = undefined;
        this.sceneRenderer = null;

        // 播放模式
        this.loop = true;           // true=循环, false=单次
        this._boneTags = {};        // { boneName: [animState1, animState2] }
        this._stateDesc = '';       // 状态描述文本
        this._exitText = '';        // 出口节点文本内容
    }
    return SpineNodeData;
})();
