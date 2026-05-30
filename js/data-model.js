/* ================================================================
   数据模型 — 全局状态 & SpineNodeData 类
   整个应用共享 SMData 全局状态对象
   ================================================================ */

// ---- 连线颜色调色板 ----
var CONN_COLORS = [
    '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7',
    '#5c7cfa', '#845ef7', '#e599f7', '#f06595', '#20c997', '#f08c00',
    '#fa5252', '#fd7e14', '#fab005', '#40c057', '#12b886', '#339af0',
    '#3b5bdb', '#7950f2', '#cc5de8', '#e64980', '#0ca678', '#e8590c'
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
    selectedConnection: null,
    showGrid: true,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    viewStart: { x: 0, y: 0 },
    // 贝塞尔控制点拖拽
    draggingCP: null,
    hoveredCP: null,
    selectingCP: false
};

// ---- Spine 节点数据类 ----
var SpineNodeData = (function () {
    function SpineNodeData(id) {
        this.id = id;
        this.name = 'Node_' + id;
        this.x = Math.random() * 200 - 100 + window.innerWidth / 2;
        this.y = Math.random() * 200 - 100 + window.innerHeight / 2;
        this.width = 300;

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
        this.premultipliedAlpha = false;

        // 原始源数据（用于导出/导入往返）
        this._srcSkelJson = null;
        this._srcSkelBinBase64 = null;
        this._srcAtlasText = '';
        this._srcTexDataUrl = '';
        this._srcType = '';

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
    }
    return SpineNodeData;
})();
