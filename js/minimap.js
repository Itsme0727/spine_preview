/* ================================================================
   鸟瞰图（Minimap）— 左下角小地图，用于大画布快速导航
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 初始化鸟瞰图 ----
SMTool._initMinimap = function () {
    SMTool.minimapEl = document.getElementById('minimap');
    SMTool.minimapCanvas = document.getElementById('minimapCanvas');
    SMTool.minimapCtx = SMTool.minimapCanvas.getContext('2d');
    SMTool.minimapViewport = document.getElementById('minimapViewport');

    SMTool._mmDragging = false;
    SMTool._mmLastDrag = { x: 0, y: 0 };

    // 鼠标事件直接绑在 minimap 元素上
    SMTool.minimapEl.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        SMTool._onMinimapDown(e);
    });

    window.addEventListener('mousemove', function (e) {
        if (SMTool._mmDragging) {
            SMTool._onMinimapMove(e);
        }
    });

    window.addEventListener('mouseup', function (e) {
        if (SMTool._mmDragging) {
            SMTool._onMinimapUp(e);
        }
    });
};

// ---- 计算所有节点的世界包围盒 ----
SMTool._getWorldBounds = function () {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.width || 300));
        maxY = Math.max(maxY, n.y + (n._canvasHeight || 200) + 100);
        result = nodesIter.next();
    }
    // 无节点时给一个默认范围
    if (!isFinite(minX)) {
        minX = -1000; minY = -1000; maxX = 1000; maxY = 1000;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
};

// ---- 渲染鸟瞰图（在 _loop 末尾调用）----
SMTool._renderMinimap = function () {
    var el = SMTool.minimapEl;
    var canvas = SMTool.minimapCanvas;
    var ctx = SMTool.minimapCtx;
    var vpEl = SMTool.minimapViewport;

    if (!el || !canvas || !ctx) return;

    // 同步 canvas 实际像素尺寸
    var rect = el.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    // ---- 计算世界到 minimap 的映射 ----
    var bb = SMTool._getWorldBounds();
    var pad = Math.max(bb.w, bb.h) * 0.25;  // 25% 边距
    if (pad < 200) pad = 200;  // 最小边距，避免节点贴边

    var worldLeft = bb.minX - pad;
    var worldTop = bb.minY - pad;
    var worldRight = bb.maxX + pad;
    var worldBottom = bb.maxY + pad;
    var worldW = worldRight - worldLeft;
    var worldH = worldBottom - worldTop;

    // 保持宽高比，适应 minimap 尺寸
    var scaleX = w / worldW;
    var scaleY = h / worldH;
    var scale = Math.min(scaleX, scaleY);

    // 在 minimap 中居中
    var offsetX = (w - worldW * scale) / 2;
    var offsetY = (h - worldH * scale) / 2;

    // 世界 → minimap 像素
    function wx(wx) { return (wx - worldLeft) * scale + offsetX; }
    function wy(wy) { return (wy - worldTop) * scale + offsetY; }

    // ---- 绘制 ----
    ctx.clearRect(0, 0, w, h);

    // 网格（简化：只在 minimap 背景上绘制几条细线）
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    var gridStep = Math.max(50, worldW / 8);
    for (var gx = Math.floor(worldLeft / gridStep) * gridStep; gx < worldRight; gx += gridStep) {
        var sx = wx(gx);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
    }
    for (var gy = Math.floor(worldTop / gridStep) * gridStep; gy < worldBottom; gy += gridStep) {
        var sy = wy(gy);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
    }

    // 连线
    ctx.lineWidth = 0.6;
    for (var i = 0; i < SMData.connections.length; i++) {
        var conn = SMData.connections[i];
        var fn = SMData.nodes.get(conn.fromNode);
        var tn = SMData.nodes.get(conn.toNode);
        if (!fn || !tn) continue;

        var x1 = wx(fn.x + (fn.width || 300) / 2);
        var y1 = wy(fn.y + ((fn._canvasHeight || 200) + 100) / 2);
        var x2 = wx(tn.x + (tn.width || 300) / 2);
        var y2 = wy(tn.y + ((tn._canvasHeight || 200) + 100) / 2);

        ctx.strokeStyle = conn.color || 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // 节点
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    var selId = SMData.selectedNode;
    while (!result.done) {
        var node = result.value;
        var nx = wx(node.x);
        var ny = wy(node.y);
        var nw = Math.max(3, (node.width || 300) * scale);
        var nh = Math.max(2, ((node._canvasHeight || 200) + 100) * scale);

        // 颜色
        var fill, stroke;
        if (node.id === selId) {
            fill = 'rgba(74, 158, 255, 0.7)';
            stroke = 'rgba(74, 158, 255, 0.9)';
        } else if (node.nodeType === 'entry') {
            fill = 'rgba(78, 201, 110, 0.5)';
            stroke = 'rgba(78, 201, 110, 0.7)';
        } else if (node.nodeType === 'exit') {
            fill = 'rgba(201, 138, 62, 0.5)';
            stroke = 'rgba(201, 138, 62, 0.7)';
        } else if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
            fill = 'rgba(180, 180, 190, 0.4)';
            stroke = 'rgba(180, 180, 190, 0.6)';
        } else {
            fill = 'rgba(100, 140, 200, 0.45)';
            stroke = 'rgba(100, 140, 200, 0.65)';
        }

        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.5;
        ctx.fillRect(nx, ny, nw, nh);
        ctx.strokeRect(nx, ny, nw, nh);

        result = nodesIter.next();
    }

    // ---- 视口矩形 ----
    var z = SMData.view.zoom;
    var vx = SMData.view.x;
    var vy = SMData.view.y;
    var vpW = window.innerWidth / z;
    var vpH = window.innerHeight / z;
    var vpLeft = -vx - vpW / 2;
    var vpTop = -vy - vpH / 2;

    var vpX = wx(vpLeft);
    var vpY = wy(vpTop);
    var vpW2 = vpW * scale;
    var vpH2 = vpH * scale;

    // 裁剪视口矩形到 minimap 范围内
    var clipX = Math.max(0, vpX);
    var clipY = Math.max(0, vpY);
    var clipW = Math.min(vpX + vpW2, w) - clipX;
    var clipH = Math.min(vpY + vpH2, h) - clipY;

    if (clipW > 0 && clipH > 0) {
        // 视口矩形背景
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(clipX, clipY, clipW, clipH);
        // 视口矩形边框
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(clipX, clipY, clipW, clipH);
    }

    // 同时用 DOM 元素做视口指示器（用于鼠标交互检测尺寸）
    vpEl.style.left = clipX + 'px';
    vpEl.style.top = clipY + 'px';
    vpEl.style.width = clipW + 'px';
    vpEl.style.height = clipH + 'px';
};

// ---- 鸟瞰图鼠标交互 ----
SMTool._onMinimapDown = function (e) {
    var el = SMTool.minimapEl;
    var rect = el.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    // 检查是否点击在视口矩形内（拖拽视口）
    var vpEl = SMTool.minimapViewport;
    var vpLeft = parseFloat(vpEl.style.left) || 0;
    var vpTop = parseFloat(vpEl.style.top) || 0;
    var vpW = parseFloat(vpEl.style.width) || 0;
    var vpH = parseFloat(vpEl.style.height) || 0;

    if (mx >= vpLeft && mx <= vpLeft + vpW && my >= vpTop && my <= vpTop + vpH && vpW > 0 && vpH > 0) {
        // 拖拽视口
        SMTool._mmDragging = true;
        SMTool._mmDragType = 'viewport';
        SMTool._mmLastDrag = { x: e.clientX, y: e.clientY };
        SMTool._mmDragStartView = { x: SMData.view.x, y: SMData.view.y };
    } else {
        // 点击跳转：将 minimap 坐标转为世界坐标，把那个位置放到视口中心
        SMTool._jumpViewToMinimap(mx, my, rect);
    }
};

SMTool._onMinimapMove = function (e) {
    if (!SMTool._mmDragging || SMTool._mmDragType !== 'viewport') return;

    var el = SMTool.minimapEl;
    var rect = el.getBoundingClientRect();
    var dx = e.clientX - SMTool._mmLastDrag.x;
    var dy = e.clientY - SMTool._mmLastDrag.y;
    SMTool._mmLastDrag = { x: e.clientX, y: e.clientY };

    // 计算 minimap 到世界的缩放比
    var bb = SMTool._getWorldBounds();
    var pad = Math.max(bb.w, bb.h) * 0.25;
    if (pad < 200) pad = 200;
    var worldW = bb.maxX - bb.minX + pad * 2;
    var worldH = bb.maxY - bb.minY + pad * 2;
    var scale = Math.min(rect.width / worldW, rect.height / worldH);

    // minimap 像素 → 世界单位
    SMData.view.x -= dx / scale;
    SMData.view.y -= dy / scale;

    SMTool._updateAllPos();
};

SMTool._onMinimapUp = function (e) {
    SMTool._mmDragging = false;
    SMTool._mmDragType = null;
};

// ---- 跳转视图到 minimap 上的某点 ----
SMTool._jumpViewToMinimap = function (mx, my, mmRect) {
    var bb = SMTool._getWorldBounds();
    var pad = Math.max(bb.w, bb.h) * 0.25;
    if (pad < 200) pad = 200;

    var worldLeft = bb.minX - pad;
    var worldTop = bb.minY - pad;
    var worldRight = bb.maxX + pad;
    var worldBottom = bb.maxY + pad;
    var worldW = worldRight - worldLeft;
    var worldH = worldBottom - worldTop;

    var scale = Math.min(mmRect.width / worldW, mmRect.height / worldH);
    var offsetX = (mmRect.width - worldW * scale) / 2;
    var offsetY = (mmRect.height - worldH * scale) / 2;

    // minimap 像素 → 世界坐标
    var worldX = (mx - offsetX) / scale + worldLeft;
    var worldY = (my - offsetY) / scale + worldTop;

    // 将点击位置设为视口中心
    SMData.view.x = -worldX;
    SMData.view.y = -worldY;

    SMTool._updateAllPos();
    SMTool._syncZoomUI();
};
