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
    _panelCache: {},         // 数据面板 HTML 缓存 { nodeId: htmlString }
    _lastPanelNodeId: -1,    // 上次渲染面板的节点 ID
    _activePanelTab: 'skin', // 当前激活的数据面板页签（skin/bone/slot/info）
    _pasteTargetBone: null,  // 粘贴截图按钮设置的目标骨骼名

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
        panelW: 280,          // 面板宽度 px
        panelH: 420,          // 面板高度 px
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
        _lastTime: 0          // 上一帧时间
    }
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
        thumbDataUrl: null,   // 懒生成：首次请求时才生成缩略图
        refCount: 1,
        hashKey: hk
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
    // 懒生成缩略图（同步标记为 pending，异步完成）
    if (entry._thumbPending) return entry.dataUrl; // 降级返回原图
    entry._thumbPending = true;
    var genThumb = (window.SMTool && window.SMTool._generateThumbnail);
    if (genThumb) {
        genThumb(entry.dataUrl).then(function (thumb) {
            entry.thumbDataUrl = thumb;
            entry._thumbPending = false;
            // 缩略图就绪后刷新面板（HTML 构建时已通过 _shotGetThumb 使用真实图片）
            if (SMData._lastPanelNodeId >= 0) {
                SMData._lastPanelNodeId = -1;
                var updateFn = window.SMTool && window.SMTool._updateFloatPanel;
                if (updateFn) updateFn();
            }
        });
    }
    return entry.dataUrl; // 降级：缩略图未就绪时返回原图
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
        this._stateDesc = '';       // 状态描述文本
        this._exitText = '';        // 出口节点文本内容
        this._customScale = 1.0;    // 用户自定义缩放比例（拖拽缩放图标调整）

        // ---- 多轨道动画混合 ----
        // tracks: [{ animName, alpha, mixBlend, enabled, loop }]
        //   animName  - 动画名称（空字符串表示无动画）
        //   alpha     - 混合透明度 0.0~1.0（1.0 = 完全不透明）
        //   mixBlend  - 混合模式: 'setup'|'first'|'replace'|'add'（仅 4.x 有效，3.8 忽略）
        //   enabled   - 是否启用此轨道
        //   loop      - 是否循环播放
        // track 0 是底层基础动画，track 1/2/... 依次叠加混合
        this.tracks = [];
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

// 将节点的轨道配置应用到 Spine AnimationState
SMTool._applyTracksToState = function (node) {
    if (!node.state || !node.skeletonData) return;

    if (!node.tracks || node.tracks.length === 0) {
        SMTool._initDefaultTracks(node);
    }

    var state = node.state;
    var is4x = (node._spineVer === '4.3' || node._spineVer === '4.2');

    state.clearTracks();

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
        }
    }

    if (node.tracks.length > 0) {
        node.currentAnim = node.tracks[0].animName;
        node.loop = node.tracks[0].loop !== false;
    }
};
