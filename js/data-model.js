/* ================================================================
   数据模型 — 全局状态 & SpineNodeData 类
   整个应用共享 SMData 全局状态对象
   ================================================================ */

var SMTool = window.SMTool || {};

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
    // 节点缩放拖拽
    scalingNode: null,    // { nodeId, startScale, startMx, startMy, startX, startY }
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
    renderMode: 'static',

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
    flowMode: 'full',

    // 完整动画组：当前源节点的所有路径
    _fullPaths: [],    // [{ nodes: [{id, anim}], conns: [id] }]

    // 完整动画组播放状态
    _fullPlayback: {
        activePathIdx: -1,   // 当前播放的路径索引
        currentStep: 0,      // 当前播放到第几个节点
        isPlaying: false,
        _stepped: false,     // 是否手动导航过（prev/next）
        _timer: null
    },

    // ---- 撤销/重做 ----
    _undoStack: [],          // 快照堆栈（最多 20 步）
    _redoStack: [],          // 重做堆栈
    _undoMaxSteps: 20,       // 最大撤销步数
    _isUndoRedo: false,      // 标记正在执行撤销/重做，防止重复压栈
    _pendingDragSnap: null,  // 拖拽开始时的快照（结束时比对后才决定是否压栈）

    // ---- 自动保存 ----
    _hasEverSaved: false,    // 是否已经手动保存过（CTRL+S 或点击导出按钮）
    _autoSaveIntervalId: null, // 自动保存定时器 ID
    _saveFileHandle: null,   // FileSystemFileHandle（首次保存后持有，用于静默覆写）
    _assetsDirHandle: null,  // FileSystemDirectoryHandle（伴随图片存储目录）
    _lastSavePath: '',       // ★ 上次保存的路径（用于 toast 提示）
    _panelCache: {},         // 数据面板 HTML 缓存 { nodeId: htmlString }
    _lastPanelNodeId: -1,    // 上次渲染面板的节点 ID
    _activePanelTab: 'skin', // 当前激活的数据面板页签（skin/bone/slot/info）
    _pasteTargetBone: null,  // 粘贴截图按钮设置的目标骨骼/皮肤/插槽名
    _pasteTargetType: 'bone', // 'bone' | 'skin' | 'slot' | 'event'
    _lastPanelFocusName: null, // 数据面板内最后聚焦的文本框所属的骨骼/皮肤/插槽名
    _lastPanelFocusType: 'bone',

    // ---- 全局截图注册表（极致去重） ----
    // 所有骨骼截图统一存储在此，节点只存 shotId 引用。
    // 同一张图片被多个节点引用时，内存中只存在一份 dataUrl。
    // 结构：{ shotId: { dataUrl, thumbDataUrl, refCount, hash } }
    _shotStore: {},
    _shotHashIndex: {},  // { hashKey: [shotId, shotId2, ...] }  采样 hash → shotId 列表，O(1) 查找
    _nextShotId: 1,

    // ---- 右上角动画预览浮窗面板状态 ----
    _animPreview: {
        visible: false,       // 面板是否可见
        nodeId: null,         // 源节点 ID
        canvas: null,         // 预览画布元素
        gl: null,             // 预览 WebGL 上下文
        skeleton: null,       // Spine 骨架实例
        state: null,          // Spine AnimationState 实例
        animName: '',         // 当前播放的动画名
        panelX: 0,            // 面板 left px
        panelY: 0,            // 面板 top px
        panelW: 385,          // 面板宽度 px
        panelH: 645,          // 面板高度 px
        _spineVer: '',        // Spine 版本 ('3.8' | '4.2' | '4.3')
        _batcher: null,       // PolygonBatcher
        _shader: null,        // Shader
        _sceneRenderer: null, // SceneRenderer
        _glTextures: [],      // GL 纹理数组
        _texImgs: [],         // 纹理 Image 对象数组
        _texCacheKeys: [],    // 纹理缓存键（用于释放）
        _atlasData: null,     // 解析后的 atlas 数据
        _skeletonData: null,  // 解析后的 skeletonData
        _canvasWidth: 0,      // 骨架像素宽
        _canvasHeight: 0,     // 骨架像素高
        _boundsOffset: null,  // {x, y} 骨架包围盒偏移
        _boundsSize: null,    // {x, y} 骨架包围盒尺寸
        _physParam: null,     // 物理参数
        _lastTime: 0,         // 上一帧时间
        _loopRestartGuard: false,  // ★ 循环重启防重入

        // ★★ 嵌套并行播放状态（金字塔模型）
        // activeTreeNodeId: 当前在浮窗面板中渲染的树节点 ID
        // treeCompleted: 整棵播放树是否已全部完成
        // nodeStates: { [treeNodeId]: { chainIdx, chainDone, delayElapsed, loopTrack } }
        // parentStack: [{ treeNodeId, layerIdx, chainIdx }] 状态栈，子节点完成后恢复
        _layerPlaybackState: {
            activeTreeNodeId: null,
            treeCompleted: false,
            nodeStates: {},
            parentStack: []
        },

        // ★★ 嵌套子树骨架缓存 { [nestedLayerNodeId]: { skeletons: [...], gl, glResources } }
        _subtreeCache: {}

    },

    // ★ 每个动画文件的预览缩放值 { sourceFile: zoomNumber }
    _previewZooms: {},

    // ★ 拖拽吸附线 { dir: 'h'|'v', pos: worldCoord }
    _snapLines: [],
    _snapEnabled: true,  // 吸附功能开关

    // ★ 组内编辑模式（双击组进入，存储正在编辑的组 ID，null=未进入）
    _groupEditMode: null,

    // ★★ 嵌套并行播放树（金字塔模型）
    // _playbackTree: { rootId, nodes: { [treeNodeId]: { id, type, layerSrcNodeId, children, parentId, completed, active } } }
    // 类型：'chainLeaf'=链上的普通节点, 'layerSubtree'=链上的子并行播放节点
    _playbackTree: null,

    // ★ 2D Canvas 缓存状态（避免每帧无效重绘）
    _lastViewZoom: 0,
    _lastViewX: 0,
    _lastViewY: 0,
    _lastConnCount: -1,
    _lastSelConn: -1,
    _lastSelCount: -1,
    _forceRedraw: true   // 初始强制重绘一次
};

// ---- 快速采样 hash（非加密，用于去重查找的 O(1) 索引） ----
// 对大图 dataUrl 进行采样计算，避免遍历全部字符，确保无卡顿。
// 采样策略：头部 + 中部 + 尾部 + 长度，覆盖整张图的关键特征。
SMData._fastHash = function (dataUrl) {
    var len = dataUrl.length;
    // 使用 32 位整数 hash（java 风格），多轮混合
    var h1 = len | 0;
    var h2 = 0x9e3779b9;

    // 采样函数：取 dataUrl 中某个区间的 hash
    function mix(str, start, end) {
        var limit = Math.min(end, str.length);
        for (var i = start; i < limit; i++) {
            var c = str.charCodeAt(i);
            h1 = ((h1 << 5) - h1 + c) | 0;
            h2 = ((h2 << 3) - h2 + c) | 0;
        }
    }

    // 前 2000 字符（含 data:image/... 头）
    mix(dataUrl, 0, 2000);

    // 中部采样——找到 base64 数据主体
    var commaIdx = dataUrl.indexOf(',');
    if (commaIdx > 0 && len > commaIdx + 3000) {
        // 跳过 MIME 头，对 base64 数据主体采样
        var payloadStart = commaIdx + 1;
        var payloadLen = len - payloadStart;
        // 采样 3 段：前段、中段、后段，每段 1000 字符
        var segLen = Math.min(1000, payloadLen >> 2);
        if (segLen > 0) {
            mix(dataUrl, payloadStart, payloadStart + segLen);
            var midStart = payloadStart + (payloadLen >> 1) - (segLen >> 1);
            mix(dataUrl, midStart, midStart + segLen);
            mix(dataUrl, len - segLen, len);
        }
    } else {
        // 无逗号或太短 → 中等采样
        var seg = Math.min(1500, len >> 2);
        if (seg > 0) {
            mix(dataUrl, seg, seg * 2);
            mix(dataUrl, len - seg, len);
        }
    }

    // 组合为字符串 key
    return (h1 >>> 0).toString(36) + '_' + (h2 >>> 0).toString(36) + '_' + len.toString(36);
};

// ---- 全局截图注册表 API（挂载到 SMData） ----
// 注册一张截图（若已存在则仅增加引用计数），返回 shotId
// ★ 使用快速采样 hash + 长度做 O(1) 索引，避免全量字符串比对
SMData._shotRegister = function (dataUrl) {
    var hk = SMData._fastHash(dataUrl);
    var bucket = SMData._shotHashIndex[hk];

    // 同一 hash 桶内查找（碰撞极少，通常只有 0~1 个条目）
    if (bucket) {
        for (var i = 0; i < bucket.length; i++) {
            var sid = bucket[i];
            var entry = SMData._shotStore[sid];
            if (entry && entry.dataUrl === dataUrl) {
                // ★ 相同图片 → 增加引用计数即可
                entry.refCount++;
                return sid;
            }
        }
    }

    // 新建条目
    var shotId = SMData._nextShotId++;
    SMData._shotStore[shotId] = {
        dataUrl: dataUrl,
        thumbDataUrl: null,
        refCount: 1,
        hashKey: hk,
        _fileName: null  // 上传时的原始文件名
    };

    // 加入 hash 索引
    if (!SMData._shotHashIndex[hk]) SMData._shotHashIndex[hk] = [];
    SMData._shotHashIndex[hk].push(shotId);

    return shotId;
};

// 获取截图的 dataUrl
SMData._shotGetDataUrl = function (shotId) {
    var entry = SMData._shotStore[shotId];
    return entry ? entry.dataUrl : null;
};

// 获取截图的缩略图（懒生成）
// 注意：SMTool 在 ui-dom.js 中定义，晚于本文件加载。
// 因此通过 window.SMTool 延迟访问，避免加载顺序依赖。
SMData._shotGetThumb = function (shotId) {
    var entry = SMData._shotStore[shotId];
    if (!entry) return null;
    if (entry.thumbDataUrl) return entry.thumbDataUrl;
    // ★ 懒生成缩略图（异步完成）
    if (entry._thumbPending) return null; // 正在生成中
    if (entry._thumbFailed) return null; // 之前生成失败，不再重试
    if (!entry.dataUrl) return null;
    entry._thumbPending = true;
    var genThumb = (window.SMTool && window.SMTool._generateThumbnail);
    if (genThumb) {
        genThumb(entry.dataUrl).then(function (thumb) {
            if (thumb) {
                entry.thumbDataUrl = thumb;
            } else {
                entry._thumbFailed = true; // 生成失败，标记不再重试
            }
            entry._thumbPending = false;
            // 缩略图就绪后刷新面板
            if (SMData._lastPanelNodeId >= 0) {
                SMData._lastPanelNodeId = -1;
                var updateFn = window.SMTool && window.SMTool._updateFloatPanel;
                if (updateFn) updateFn();
            }
            // ★ 刷新所有引用此 shotId 的节点缩略图
            var refreshFn = window.SMTool && window.SMTool._refreshNodeImageByShotId;
            if (refreshFn) refreshFn(shotId);
        }).catch(function () {
            entry._thumbPending = false;
            entry._thumbFailed = true;
        });
    } else {
        entry._thumbPending = false;
        entry._thumbFailed = true;
    }
    return null; // ★ 缩略图未就绪，返回 null（由调用方处理占位）
};

// 增加引用计数（复制节点时使用）
SMData._shotAddRef = function (shotId) {
    var entry = SMData._shotStore[shotId];
    if (entry) entry.refCount++;
};

// 释放引用（删除截图或节点时使用）
SMData._shotRelease = function (shotId) {
    var entry = SMData._shotStore[shotId];
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
        // 从 hash 索引中移除
        var hk = entry.hashKey;
        if (hk && SMData._shotHashIndex[hk]) {
            var bucket = SMData._shotHashIndex[hk];
            var idx = bucket.indexOf(shotId);
            if (idx >= 0) bucket.splice(idx, 1);
            if (bucket.length === 0) delete SMData._shotHashIndex[hk];
        }
        delete SMData._shotStore[shotId];
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
        this.textureImg = null;         // 第一页纹理（向后兼容）
        this._texImgs = [];             // Image[] 按 atlas page 索引顺序
        this.skeleton = null;
        this.state = null;
        this.animations = [];
        this.skins = [];
        this.slots = [];
        this.bones = [];
        this.version = '';
        this.currentAnim = '';
        this.currentSkin = '';
        this.premultipliedAlpha = true;

        // 原始源数据（用于导出/导入往返）
        this._srcSkelJson = null;
        this._srcSkelBinBase64 = null;
        this._srcAtlasText = '';
        this._srcTexDataUrl = '';       // 第一页纹理（向后兼容）
        this._srcTexDataUrls = [];      // [{ name: 'pageName.png', dataUrl: '...' }] 多图集支持
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
        this._boneNotes = {};       // { boneName: "备注文本" }
        this._boneScreenshots = {}; // { boneName: ["dataUrl1", "dataUrl2", ...] }
        this._boneThumbnails = {};  // { boneName: ["thumbDataUrl1", ...] } 缩略图，面板展示用
        this._boneShotRefs = {};    // { boneName: ["_assets/shot_xxx.jpg", ...] } 伴随 JPG 引用
        this._boneFade = {};        // { boneName: { enabled: bool, duration: number } }
        this._stateDesc = '';       // 状态描述文本
        this._exitText = '';        // 出口节点文本内容

        // ★ 皮肤备注/截图/淡入淡出
        this._skinNotes = {};       // { skinName: "备注文本" }
        this._skinScreenshots = {}; // { skinName: [shotId, ...] }
        this._skinFade = {};        // { skinName: { enabled: bool, duration: number } }

        // ★ 插槽标记/备注/截图/淡入淡出
        this._slotTags = {};        // { slotName: [animState1, ...] }
        this._slotNotes = {};       // { slotName: "备注文本" }
        this._slotScreenshots = {}; // { slotName: [shotId, ...] }
        this._slotFade = {};        // { slotName: { enabled: bool, duration: number } }
        this._slotShotMounted = {}; // { slotName: { shotIndex: true/false } } 插槽截图挂载状态，默认挂载

        // ★ 节点面板右上角图片附件（shotId 数组）
        this._nodeImages = [];
        // ★ 节点图片附件文件引用路径（导出/导入用）
        this._nodeShotRefs = [];

        this._customScale = 1.0;    // 用户自定义缩放比例（拖拽缩放图标调整）
        this._playbackSpeed = 1.0;  // 播放倍速（-5.00 ~ +5.00，默认1.00）
        this._debugOffsetX = 0;     // 调试模式：动画层水平偏移（世界单位）
        this._debugOffsetY = 0;     // 调试模式：动画层垂直偏移（世界单位）
        this._debugCanvasW = 0;     // 调试模式：裁剪区域宽度（0=使用默认 _canvasWidth）
        this._debugCanvasH = 0;     // 调试模式：裁剪区域高度（0=使用默认 _canvasHeight）

        // ---- 多轨道叠加系统 (Track System) ----
        // ★ Spine Runtime 核心概念:
        //   Track（轨道）= 一个独立的动画播放器
        //   Mix（混合过渡）= 同一轨道内动画序列切换时的平滑过渡 (A → B → C)
        //   多 Track = 多个动画序列同时叠加 (走 + 瞄准 → 射击)
        //
        // tracks（旧版兼容）: [{ animName, alpha, mixBlend, enabled, loop, mixDuration }]
        this.tracks = [];

        // ★ 轨道动画模式（新版序列队列系统）
        //   _trackMode: false=传统单动画节点 | true=轨道动画节点
        //   _trackName: 轨道模式下显示的节点名称（默认"轨道动画"）
        //   _trackSequence: [{ animations: [{name, mixOut}], loopSeq, alpha, enabled, mixBlend }]
        this._trackMode = false;
        this._trackName = '轨道动画';
        this._trackSequence = [];
        this._trackSeqLoop = {};  // { trackIndex: boolean } 运行时标记

        // ★ 同轨动画切换过渡表: { "fromAnim→toAnim": durationSeconds }
        this._mixTable = {};

        // ★ 循环控制
        this._loopMode = null;
        this._loopCount = 1;
        this._loopTime = null;

        // ★ 脏标记：为 true 时需要在下一帧重新渲染（位置/动画/皮肤变化时置 true）
        this._dirty = true;
        // ★ 上一帧的屏幕位置缓存（用于检测是否需要重绘）
        this._lastSX = 0;
        this._lastSY = 0;
        this._lastSW = 0;
        this._lastSH = 0;
    }
    return SpineNodeData;
})();

// ---- 轨道管理工具函数 ----

// 为节点初始化默认轨道（单轨道，使用当前动画）
SMTool._initDefaultTracks = function (node) {
    if (!node.tracks || node.tracks.length === 0) {
        node.tracks = [{
            animName: node.currentAnim || (node.animations[0] && node.animations[0].name) || '',
            alpha: 1.0,
            mixBlend: 'replace',
            enabled: true,
            loop: node.loop !== false,
            mixDuration: 0
        }];
    }
    // 向后兼容：track 0 同步到 currentAnim / loop
    if (node.tracks.length > 0) {
        node.currentAnim = node.tracks[0].animName;
        node.loop = node.tracks[0].loop !== false;
    }
};

// MixBlend 数值映射（spine-webgl 4.3.2 移除了全局 MixBlend 枚举，必须用数值）
SMTool._mixBlendValue = function (blendName) {
    var MAP = { 'setup': 0, 'first': 1, 'replace': 2, 'add': 3 };
    return MAP[blendName] !== undefined ? MAP[blendName] : 2;
};

// ★ 将节点的过渡表应用到 Spine Runtime AnimationStateData
//    调用 stateData.setMix(fromAnim, toAnim, duration) 设置同轨动画切换过渡
SMTool._applyMixTable = function (node) {
    if (!node.state || !node.state.data) return;
    var sd = node.state.data;  // AnimationStateData
    var table = node._mixTable || {};

    // 遍历转换表，设置每对动画的过渡时间
    var keys = Object.keys(table);
    for (var ki = 0; ki < keys.length; ki++) {
        var key = keys[ki];
        var parts = key.split('→');
        if (parts.length === 2) {
            var from = parts[0].trim();
            var to = parts[1].trim();
            var dur = parseFloat(table[key]) || 0;
            if (from && to && dur >= 0) {
                sd.setMix(from, to, dur);
            }
        }
    }
};

// ★ 设置单个动画对的过渡时间（同时更新 _mixTable 和 Runtime）
SMTool._setTrackMix = function (node, fromAnim, toAnim, duration) {
    if (!fromAnim || !toAnim) return;
    var key = fromAnim + '→' + toAnim;
    if (!node._mixTable) node._mixTable = {};
    node._mixTable[key] = duration;
    // 同步到 Runtime
    if (node.state && node.state.data) {
        node.state.data.setMix(fromAnim, toAnim, duration);
    }
};

// 将节点的轨道配置应用到 Spine AnimationState
// 模式切换前统一清空 Runtime 表现。配置数据（_trackSequence / tracks）保留，
// 但 TrackEntry、mixingFrom、临时 Slot Alpha 和上一模式的骨骼姿势全部丢弃。
SMTool._clearAnimationModeRuntime = function (node) {
    if (!node) return;
    SMTool._restoreTrackMixSlotGuard(node);
    node._trackMixSlotGuards = {};
    node._pendingTrackMixSlotRestore = null;
    node._trackQueueRuntime = {};
    node._trackSeqLoop = {};
    node._cfState = null;
    node._seqIdx = null;
    node._seqStates = null;
    node._lastEventCheckTime = 0;

    if (node.state) {
        try { node.state.clearTracks(); } catch (e) {}
    }
    if (node.skeleton) {
        try { node.skeleton.setToSetupPose(); } catch (e) {}
        try {
            if (node.state) {
                node.state.update(0);
                node.state.apply(node.skeleton);
            }
            node.skeleton.updateWorldTransform(node._physParam);
        } catch (e) {}
    }
    node._dirty = true;
    SMData._forceRedraw = true;
};

SMTool._applyTracksToState = function (node) {
    if (!node.state || !node.skeletonData) return;

    if (!node.tracks || node.tracks.length === 0) {
        SMTool._initDefaultTracks(node);
    }

    // 普通模式必须从干净的 Setup Pose 开始，否则轨道模式未被新动画控制的
    // 骨骼、Slot 或 Attachment 会残留在画面中。
    SMTool._clearAnimationModeRuntime(node);
    var state = node.state;
    var is4x = (node._spineVer === '4.3' || node._spineVer === '4.2');

    // ★ 先应用过渡表，确保同轨动画切换有平滑过渡
    SMTool._applyMixTable(node);

    var prevAnim = {};  // 记录每个轨道上一次的动画名，用于后续设置过渡

    for (var ti = 0; ti < node.tracks.length; ti++) {
        var track = node.tracks[ti];
        if (!track.enabled || !track.animName) continue;

        var animExists = false;
        for (var ai = 0; ai < node.animations.length; ai++) {
            if (node.animations[ai].name === track.animName) { animExists = true; break; }
        }
        if (!animExists) continue;

        var entry = state.setAnimation(ti, track.animName, track.loop !== false);
        if (entry) {
            if (track.alpha !== undefined && track.alpha >= 0 && track.alpha <= 1) {
                entry.alpha = track.alpha;
            }
            // ★ 用数值设置 mixBlend（兼容 spine 3.8/4.2/4.3）
            if (is4x && track.mixBlend) {
                entry.mixBlend = SMTool._mixBlendValue(track.mixBlend);
            }
            // ★ 设置该轨道的切换过渡时间（mixDuration 控制从上一个动画过渡到当前动画的时间）
            if (track.mixDuration !== undefined && track.mixDuration > 0 && prevAnim[ti]) {
                entry.mixDuration = track.mixDuration;
                // 同时注册到过渡表，下次切换到其他动画时也能过渡
                SMTool._setTrackMix(node, prevAnim[ti], track.animName, track.mixDuration);
            }
            prevAnim[ti] = track.animName;
        }
    }

    if (node.tracks.length > 0) {
        node.currentAnim = node.tracks[0].animName;
        node.loop = node.tracks[0].loop !== false;
    }
    if (node.skeleton) {
        state.update(0);
        state.apply(node.skeleton);
        node.skeleton.updateWorldTransform(node._physParam);
    }
    node._dirty = true;
    SMData._forceRedraw = true;
};

// ★ 为新激活的轨道动画节点初始化默认序列
SMTool._initDefaultTrackSequence = function (node) {
    if (!node._trackSequence || node._trackSequence.length === 0) {
        var curAnim = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';
        node._trackSequence = [{
            animations: [{ name: curAnim, mixOut: 0 }],
            loopSeq: true,
            alpha: 1.0,
            enabled: true,
            mixBlend: 'replace'
        }];
    }
};

// ★ 轨道序列原生队列系统
//    每一条 UI 轨道 = Spine AnimationState 中同索引的一条真实轨道。
//    同轨道：setAnimation + addAnimation 构建 A → B → C 队列；mixOut 是“当前动画到下一个动画”的混合秒数。
//    多轨道：由 AnimationState 按轨道索引从低到高叠加到同一个 Skeleton，禁止用双轨 alpha 伪造画面淡入淡出。

// 检查动画是否存在，避免错误名称让整条队列构建失败。
SMTool._sequenceHasAnimation = function (owner, name) {
    if (!name) return false;
    var data = owner && (owner.skeletonData || owner._skeletonData);
    if (data) {
        if (typeof data.findAnimation === 'function') {
            try { return !!data.findAnimation(name); } catch (e) {}
        }
        var list = data.animations || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].name === name) return true;
        }
    }
    var fallback = owner && owner.animations;
    if (fallback) {
        for (var j = 0; j < fallback.length; j++) {
            if (fallback[j] && fallback[j].name === name) return true;
        }
    }
    return false;
};

SMTool._sequenceNextEntry = function (entry) {
    if (!entry) return null;
    return entry.next || entry._next || null;
};

// TrackEntry 在不同 spine-ts 版本中的“完成时间”兼容读取。
SMTool._sequenceTrackComplete = function (entry) {
    if (!entry) return 0;
    try {
        if (typeof entry.getTrackComplete === 'function') return entry.getTrackComplete();
        if (typeof entry.trackComplete === 'number' && isFinite(entry.trackComplete)) return entry.trackComplete;
    } catch (e) {}

    var anim = entry.animation || entry._animation;
    var start = (typeof entry.animationStart === 'number') ? entry.animationStart : 0;
    var end = (typeof entry.animationEnd === 'number') ? entry.animationEnd : (anim && anim.duration ? anim.duration : 0);
    var duration = Math.max(0, end - start);
    var trackTime = (typeof entry.trackTime === 'number') ? entry.trackTime : 0;
    if (entry.loop && duration > 0) return duration * (1 + Math.floor(trackTime / duration));
    return Math.max(duration, trackTime);
};

SMTool._applySequenceEntryStyle = function (entry, seq, spineVer) {
    if (!entry) return;
    var alpha = (seq && seq.alpha !== undefined) ? Number(seq.alpha) : 1;
    if (!isFinite(alpha)) alpha = 1;
    entry.alpha = Math.max(0, Math.min(1, alpha));

    // 当前工程的 4.x 运行时使用数值 MixBlend；3.8 保持运行时默认 replace，避免跨版本枚举不一致。
    if ((spineVer === '4.3' || spineVer === '4.2') && seq && seq.mixBlend) {
        entry.mixBlend = SMTool._mixBlendValue(seq.mixBlend);
    }
};

// 为 addAnimation 返回的 TrackEntry 设置精确混合时间，并同步修正 delay。
// 仅修改 mixDuration 而不改 delay，会导致 0.5 秒混合仍从错误时刻开始，这是旧版本的核心 Bug。
SMTool._setQueuedEntryMix = function (entry, previousEntry, mixDuration) {
    if (!entry) return;
    var mix = Number(mixDuration);
    if (!isFinite(mix) || mix < 0) mix = 0;

    // Spine 4.3 新接口会同时重算 delay；旧版运行时使用兼容公式。
    if (previousEntry && typeof entry.setMixDuration === 'function') {
        try {
            entry.setMixDuration(mix, 0);
            return;
        } catch (e) {}
    }

    entry.mixDuration = mix;
    if (previousEntry) {
        entry.delay = SMTool._sequenceTrackComplete(previousEntry) - mix;
    }
};

SMTool._sanitizeTrackSequenceAnimations = function (owner, seq) {
    var src = (seq && seq.animations) || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
        var a = src[i];
        if (!a || !SMTool._sequenceHasAnimation(owner, a.name)) continue;
        var mix = Number(a.mixOut);
        if (!isFinite(mix) || mix < 0) mix = 0;
        out.push({ name: a.name, mixOut: mix });
    }
    return out;
};

// 读取动画时长（秒）。该函数只读，不修改节点或 Runtime 状态。
SMTool._animationDurationSeconds = function (owner, animationName) {
    if (!owner || !animationName) return 0;
    var data = owner.skeletonData || owner._skeletonData;
    var lists = [];
    if (data && data.animations) lists.push(data.animations);
    if (owner.animations && (!data || owner.animations !== data.animations)) lists.push(owner.animations);
    for (var li = 0; li < lists.length; li++) {
        var list = lists[li] || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].name === animationName) {
                var duration = Number(list[i].duration);
                return isFinite(duration) && duration > 0 ? duration : 0;
            }
        }
    }
    return 0;
};

// 一条 UI 轨道完成一轮序列所需的真实时间。
// mixOut 表示当前动画结束前多少秒开始下一动画，因此总时长需要扣除重叠区间。
SMTool._trackSequenceDurationSeconds = function (owner, seq) {
    if (!seq || seq.enabled === false) return 0;
    var animations = SMTool._sanitizeTrackSequenceAnimations(owner, seq);
    if (animations.length === 0) return 0;
    var total = SMTool._animationDurationSeconds(owner, animations[0].name);
    for (var i = 1; i < animations.length; i++) {
        var previousDuration = SMTool._animationDurationSeconds(owner, animations[i - 1].name);
        var currentDuration = SMTool._animationDurationSeconds(owner, animations[i].name);
        var overlap = Math.max(0, Number(animations[i - 1].mixOut) || 0);
        overlap = Math.min(overlap, previousDuration);
        total += Math.max(0, currentDuration - overlap);
    }
    return Math.max(0, total);
};

// 多条轨道同时播放，节点一轮时长取所有启用轨道中的最大值。
SMTool._trackNodeDurationSeconds = function (owner) {
    if (!owner || !owner._trackMode) return 0;
    var seqs = owner._trackSequence || [];
    var maxDuration = 0;
    for (var i = 0; i < seqs.length; i++) {
        maxDuration = Math.max(maxDuration, SMTool._trackSequenceDurationSeconds(owner, seqs[i]));
    }
    return maxDuration;
};

// 追加一个完整循环周期。调用前，当前队列尾部必须是本序列的最后一个动画。
SMTool._appendNativeSequenceCycle = function (owner, state, trackIndex, runtimeInfo, seq, spineVer) {
    if (!runtimeInfo || !runtimeInfo.animations || runtimeInfo.animations.length < 2) return;
    var anims = runtimeInfo.animations;
    var prevEntry = runtimeInfo.tail;
    var prevDef = anims[anims.length - 1];

    for (var i = 0; i < anims.length; i++) {
        var curDef = anims[i];
        var entry = null;
        try { entry = state.addAnimation(trackIndex, curDef.name, false, 0); } catch (e) { entry = null; }
        if (!entry) continue;
        SMTool._setQueuedEntryMix(entry, prevEntry, prevDef.mixOut);
        SMTool._applySequenceEntryStyle(entry, seq, spineVer);
        prevEntry = entry;
        prevDef = curDef;
    }
    runtimeInfo.tail = prevEntry;
};

// 在指定 AnimationState 上构建一条原生轨道序列。
SMTool._buildNativeTrackSequence = function (owner, state, seqs, spineVer, trackIndex, clearTrackFirst) {
    if (!owner || !state || !seqs) return;
    var seq = seqs[trackIndex];
    if (!owner._trackQueueRuntime) owner._trackQueueRuntime = {};

    if (clearTrackFirst) {
        try { state.clearTrack(trackIndex); } catch (e) {}
    }
    delete owner._trackQueueRuntime[trackIndex];

    if (!seq || seq.enabled === false) return;
    var anims = SMTool._sanitizeTrackSequenceAnimations(owner, seq);
    if (anims.length === 0) return;

    var loopSeq = seq.loopSeq !== false;
    var singleLoop = loopSeq && anims.length === 1;
    var firstEntry = null;
    try { firstEntry = state.setAnimation(trackIndex, anims[0].name, singleLoop); } catch (e) { firstEntry = null; }
    if (!firstEntry) return;

    firstEntry.mixDuration = 0;
    SMTool._applySequenceEntryStyle(firstEntry, seq, spineVer);

    var runtimeInfo = {
        animations: anims,
        loop: loopSeq,
        tail: firstEntry,
        sequenceLength: anims.length
    };
    owner._trackQueueRuntime[trackIndex] = runtimeInfo;

    // 单动画循环直接使用 Spine 自身 loop，不额外构建队列。
    if (anims.length === 1) return;

    var prevEntry = firstEntry;
    var prevDef = anims[0];
    for (var ai = 1; ai < anims.length; ai++) {
        var curDef = anims[ai];
        var queued = null;
        try { queued = state.addAnimation(trackIndex, curDef.name, false, 0); } catch (e) { queued = null; }
        if (!queued) continue;
        SMTool._setQueuedEntryMix(queued, prevEntry, prevDef.mixOut);
        SMTool._applySequenceEntryStyle(queued, seq, spineVer);
        prevEntry = queued;
        prevDef = curDef;
    }
    runtimeInfo.tail = prevEntry;

    // 循环序列预先排入下一整轮，确保“末动画 → 首动画”的混合能在末动画结束前启动。
    if (loopSeq) SMTool._appendNativeSequenceCycle(owner, state, trackIndex, runtimeInfo, seq, spineVer);
};

// 渲染循环只负责维持足够长的未来队列，不再手动切动画或改双轨 alpha。
SMTool._maintainNativeTrackSequences = function (owner, state, seqs, spineVer) {
    if (!owner || !state || !seqs || !owner._trackQueueRuntime) return;

    for (var ti = 0; ti < seqs.length; ti++) {
        var info = owner._trackQueueRuntime[ti];
        var seq = seqs[ti];
        if (!info || !info.loop || info.sequenceLength < 2 || !seq || seq.enabled === false) continue;

        var current = null;
        try { current = state.getCurrent(ti); } catch (e) { current = null; }
        if (!current) {
            SMTool._buildNativeTrackSequence(owner, state, seqs, spineVer, ti, true);
            continue;
        }

        var remaining = 0;
        var cursor = current;
        var tail = current;
        var guard = 0;
        while (cursor && guard < 200) {
            remaining++;
            tail = cursor;
            cursor = SMTool._sequenceNextEntry(cursor);
            guard++;
        }
        info.tail = tail;

        // 保持至少“一整轮 + 当前/边界动画”的缓冲，避免跨循环时来不及排入首动画。
        if (remaining <= info.sequenceLength + 1) {
            SMTool._appendNativeSequenceCycle(owner, state, ti, info, seq, spineVer);
        }
    }
};

SMTool._setNativeTrackAlpha = function (owner, state, trackIndex, alpha) {
    if (!state) return;
    var value = Number(alpha);
    if (!isFinite(value)) value = 1;
    value = Math.max(0, Math.min(1, value));
    var entry = null;
    try { entry = state.getCurrent(trackIndex); } catch (e) { entry = null; }
    var guard = 0;
    while (entry && guard < 200) {
        entry.alpha = value;
        entry = SMTool._sequenceNextEntry(entry);
        guard++;
    }
};

// ★ 轨道混合稳定器（未关键帧位移 + 新出现附件防飞入）
//
// Spine 的附件最终位置不仅受“附件自身”影响，还会继承父骨骼、祖先骨骼和约束。
// 当 B 在混合开始时把一个原本隐藏的附件显示出来，而父级姿势仍在 A→B 过渡，
// 视觉上可能出现“光圈从远处飞到中心”。这并不一定代表 B 给光圈本身打了 XY 帧。
//
// 本工具采用两层保护：
// 1) 每帧应用轨道前，只把“当前轨道和 mixingFrom 链完全未控制”的骨骼恢复到 Setup Pose，
//    不重置正在动画中的骨骼、Slot、Attachment，也不破坏多轨叠加与物理约束。
// 2) 对“混合开始前不可见、混合后新出现且父骨骼发生明显位移”的 Slot，
//    在混合前段暂时保持透明，最后 28% 平滑淡入，避免把父级混合位移暴露成飞入画面。
//    这只是渲染期 Alpha 门控，绘制完成后会立即还原，不改 Spine 数据和动画关键帧。

SMTool._animationBoneIndexSet = function (animation, out) {
    if (!animation || !out) return;

    // Spine 4.3 会直接提供 Animation.bones。
    var direct = animation.bones;
    if (direct && typeof direct.length === 'number') {
        for (var di = 0; di < direct.length; di++) {
            var directIndex = Number(direct[di]);
            if (isFinite(directIndex) && directIndex >= 0) out[directIndex] = true;
        }
    }

    // Spine 3.8 / 4.2 及兼容导出：从 Timeline 上读取 boneIndex。
    var timelines = animation.timelines || animation._timelines || [];
    for (var ti = 0; ti < timelines.length; ti++) {
        var timeline = timelines[ti];
        if (!timeline) continue;
        var boneIndex = timeline.boneIndex;
        if (boneIndex === undefined) boneIndex = timeline._boneIndex;
        boneIndex = Number(boneIndex);
        if (isFinite(boneIndex) && boneIndex >= 0) out[boneIndex] = true;
    }
};

SMTool._resetTrackBoneBaseline = function (owner, state, skeleton) {
    if (!owner || !state || !skeleton || !owner._trackMode || !owner._trackSequence) return;

    // 只恢复“当前所有轨道及 mixingFrom 链都没有控制”的骨骼。
    // 不能粗暴 setBonesToSetupPose：那会重置正在播放的骨骼，也可能干扰物理约束和多轨叠加。
    var animatedBones = {};
    var seqCount = owner._trackSequence.length;
    for (var trackIndex = 0; trackIndex < seqCount; trackIndex++) {
        var entry = null;
        try { entry = state.getCurrent(trackIndex); } catch (e) { entry = null; }
        var chainGuard = 0;
        while (entry && chainGuard < 50) {
            SMTool._animationBoneIndexSet(entry.animation || entry._animation, animatedBones);
            entry = SMTool._trackEntryMixingFrom(entry);
            chainGuard++;
        }
    }

    var bones = skeleton.bones || [];
    for (var i = 0; i < bones.length; i++) {
        if (animatedBones[i]) continue;
        var bone = bones[i];
        if (!bone) continue;
        try {
            if (typeof bone.setToSetupPose === 'function') bone.setToSetupPose();
            else if (typeof bone.setupPose === 'function') bone.setupPose();
        } catch (e2) {}
    }
};

SMTool._trackEntryMixingFrom = function (entry) {
    return entry ? (entry.mixingFrom || entry._mixingFrom || null) : null;
};

SMTool._trackEntryMixProgress = function (entry) {
    if (!entry) return 1;
    var duration = Number(entry.mixDuration);
    var time = Number(entry.mixTime);
    if (!isFinite(duration) || duration <= 0) return 1;
    if (!isFinite(time) || time < 0) time = 0;
    return Math.max(0, Math.min(1, time / duration));
};

SMTool._slotVisualAlpha = function (slot) {
    if (!slot) return 0;
    if (slot.color && isFinite(slot.color.a)) return Number(slot.color.a);
    if (isFinite(slot.a)) return Number(slot.a);
    return 1;
};

SMTool._setSlotVisualAlpha = function (slot, value) {
    if (!slot) return false;
    if (slot.color && isFinite(slot.color.a)) {
        slot.color.a = value;
        return true;
    }
    if (isFinite(slot.a)) {
        slot.a = value;
        return true;
    }
    return false;
};

SMTool._slotAttachment = function (slot) {
    if (!slot) return null;
    return slot.attachment !== undefined ? slot.attachment : (slot._attachment || null);
};

SMTool._slotBoneWorld = function (slot) {
    var bone = slot && slot.bone;
    if (!bone) return { x: 0, y: 0, valid: false };
    var x = Number(bone.worldX), y = Number(bone.worldY);
    if (!isFinite(x) || !isFinite(y)) {
        x = Number(bone.x); y = Number(bone.y);
    }
    return { x: isFinite(x) ? x : 0, y: isFinite(y) ? y : 0, valid: isFinite(x) && isFinite(y) };
};

SMTool._restoreTrackMixSlotGuard = function (owner) {
    if (!owner || !owner._pendingTrackMixSlotRestore) return;
    var list = owner._pendingTrackMixSlotRestore;
    owner._pendingTrackMixSlotRestore = null;
    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (item && item.slot) SMTool._setSlotVisualAlpha(item.slot, item.alpha);
    }
};

// 必须在 state.apply 之前调用，此时 skeleton 仍是上一渲染帧的最终姿势。
SMTool._prepareTrackMixSlotGuard = function (owner, state, skeleton) {
    if (!owner || !state || !skeleton || !owner._trackMode || !owner._trackSequence) return;

    // 上一帧即使因异常路径没能及时还原，也在下一帧应用动画前强制还原。
    SMTool._restoreTrackMixSlotGuard(owner);

    if (!owner._trackMixSlotGuards) owner._trackMixSlotGuards = {};
    var slots = skeleton.slots || [];
    var seqCount = owner._trackSequence.length;

    for (var ti = 0; ti < seqCount; ti++) {
        var current = null;
        try { current = state.getCurrent(ti); } catch (e) { current = null; }
        var mixingFrom = SMTool._trackEntryMixingFrom(current);
        var progress = SMTool._trackEntryMixProgress(current);

        if (!current || !mixingFrom || progress >= 1) {
            delete owner._trackMixSlotGuards[ti];
            continue;
        }

        var existing = owner._trackMixSlotGuards[ti];
        if (existing && existing.entry === current) continue;

        var entering = [];
        for (var si = 0; si < slots.length; si++) {
            var slot = slots[si];
            if (!slot) continue;
            var attachment = SMTool._slotAttachment(slot);
            var alpha = SMTool._slotVisualAlpha(slot);
            // 混合前没有附件，或附件实际透明，视为“新出现候选”。
            if (!attachment || alpha <= 0.01) {
                var pos = SMTool._slotBoneWorld(slot);
                entering.push({ index: si, startX: pos.x, startY: pos.y, validPos: pos.valid });
            }
        }
        owner._trackMixSlotGuards[ti] = { entry: current, slots: entering };
    }
};

// 必须在 state.apply + skeleton.updateWorldTransform 之后、真正绘制之前调用。
SMTool._applyTrackMixSlotGuard = function (owner, state, skeleton) {
    if (!owner || !state || !skeleton || !owner._trackMixSlotGuards) return;
    var slots = skeleton.slots || [];
    var restore = [];

    for (var key in owner._trackMixSlotGuards) {
        if (!Object.prototype.hasOwnProperty.call(owner._trackMixSlotGuards, key)) continue;
        var ti = parseInt(key, 10);
        var guard = owner._trackMixSlotGuards[key];
        var current = null;
        try { current = state.getCurrent(ti); } catch (e) { current = null; }
        if (!guard || !current || guard.entry !== current || !SMTool._trackEntryMixingFrom(current)) continue;

        var progress = SMTool._trackEntryMixProgress(current);
        if (progress >= 1) continue;

        for (var i = 0; i < guard.slots.length; i++) {
            var info = guard.slots[i];
            var slot = slots[info.index];
            if (!slot || !SMTool._slotAttachment(slot)) continue;

            var originalAlpha = SMTool._slotVisualAlpha(slot);
            if (originalAlpha <= 0) continue;

            var pos = SMTool._slotBoneWorld(slot);
            var dx = pos.x - info.startX;
            var dy = pos.y - info.startY;
            var moved = info.validPos && pos.valid && (dx * dx + dy * dy > 4); // 超过约 2 个 Spine 单位
            if (!moved) continue;

            // 前 72% 隐藏，最后 28% 使用 smoothstep 淡入；越接近 B 最终姿势越清晰。
            var t = (progress - 0.72) / 0.28;
            t = Math.max(0, Math.min(1, t));
            var gate = t * t * (3 - 2 * t);
            restore.push({ slot: slot, alpha: originalAlpha });
            SMTool._setSlotVisualAlpha(slot, originalAlpha * gate);
        }
    }

    if (restore.length > 0) owner._pendingTrackMixSlotRestore = restore;
};

// ★ 将全部轨道序列配置应用到 Spine AnimationState。
SMTool._applyTrackSequence = function (node) {
    if (!node.state || !node._trackMode) return;

    var state = node.state;
    var seqs = node._trackSequence || [];
    SMTool._restoreTrackMixSlotGuard(node);
    node._trackMixSlotGuards = {};
    if (node.skeleton) node.skeleton.setToSetupPose();
    state.clearTracks();
    node._trackQueueRuntime = {};
    node._cfState = null; // 兼容旧工程字段：彻底停用双轨淡入淡出状态机。
    node._seqIdx = null;

    for (var ti = 0; ti < seqs.length; ti++) {
        SMTool._buildNativeTrackSequence(node, state, seqs, node._spineVer, ti, false);
        node._trackSeqLoop[ti] = !!(seqs[ti] && seqs[ti].loopSeq !== false);
    }

    if (node.skeleton) {
        state.update(0);
        state.apply(node.skeleton);
        node.skeleton.updateWorldTransform(node._physParam);
    }
    node._dirty = true;
    SMData._forceRedraw = true;
};

// 旧函数名保留为兼容入口；现在直接重建对应的原生轨道。
SMTool._continueSeqAfterCf = function (node, ti) {
    SMTool._applySingleTrackSeq(node, ti);
};

// ★ 只重建一条轨道，不清除其他轨道。
SMTool._applySingleTrackSeq = function (node, ti) {
    if (!node.state || !node._trackMode) return;
    var seqs = node._trackSequence || [];
    if (ti < 0 || ti >= seqs.length) return;

    SMTool._restoreTrackMixSlotGuard(node);
    if (node._trackMixSlotGuards) delete node._trackMixSlotGuards[ti];
    if (node.skeleton) node.skeleton.setToSetupPose();
    SMTool._buildNativeTrackSequence(node, node.state, seqs, node._spineVer, ti, true);

    if (node.skeleton) {
        node.state.update(0);
        node.state.apply(node.skeleton);
        node.skeleton.updateWorldTransform(node._physParam);
    }
    node._dirty = true;
    SMData._forceRedraw = true;
};
