/* ================================================================
   网格背景 & 贝塞尔连线渲染
   负责: Canvas 网格背景绘制、节点间的贝塞尔曲线连线渲染
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 网格背景 ----
SMTool._renderGrid = function () {
    var ctx = SMTool.gridCtx;
    var w = SMTool.gridCanvas.width;
    var h = SMTool.gridCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!SMData.showGrid) return;

    var z = SMData.view.zoom;
    var vx = SMData.view.x;
    var vy = SMData.view.y;

    // 自适应网格间距
    var base = 50;
    while (base * z < 30) base *= 2;
    while (base * z > 200) base /= 2;

    var s = base * z;
    var ox = ((w / 2 + vx * z) % s + s) % s;
    var oy = ((h / 2 + vy * z) % s + s) % s;

    ctx.strokeStyle = base >= 200 ? '#ffffff10' : '#ffffff06';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = ox; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (var y = oy; y < h; y += s) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // 中心十字线
    var cx = w / 2 + vx * z;
    var cy = h / 2 + vy * z;
    ctx.strokeStyle = '#ffffff20';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();
};

// ---- 圆角矩形 ----
SMTool._roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

// ---- 贝塞尔连线渲染 ----
SMTool._renderConnections = function () {
    var ctx = SMTool.connCtx;
    ctx.clearRect(0, 0, SMTool.connCanvas.width, SMTool.connCanvas.height);

    var selConn = SMData.selectedConnection;
    var dragging = SMData.draggingCP;

    for (var i = 0; i < SMData.connections.length; i++) {
        var conn = SMData.connections[i];
        var fn = SMData.nodes.get(conn.fromNode);
        var tn = SMData.nodes.get(conn.toNode);
        if (!fn || !tn) continue;

        var fp = SMTool._getStateConnectorPos(fn, conn.fromState, 'output');
        var tp = SMTool._getStateConnectorPos(tn, conn.toState, 'input');
        if (!fp || !tp) continue;

        var fs = SMTool.worldToCanvas(fp.x, fp.y);
        var ts = SMTool.worldToCanvas(tp.x, tp.y);

        // 控制点偏移（世界坐标）
        var cp1x = conn.cp1x !== undefined ? conn.cp1x : 50;
        var cp1y = conn.cp1y !== undefined ? conn.cp1y : 0;
        var cp2x = conn.cp2x !== undefined ? conn.cp2x : -50;
        var cp2y = conn.cp2y !== undefined ? conn.cp2y : 0;

        var cp1s = SMTool.worldToCanvas(fp.x + cp1x, fp.y + cp1y);
        var cp2s = SMTool.worldToCanvas(tp.x + cp2x, tp.y + cp2y);

        // 连线颜色
        var connColor = conn.color || _connColor(i);
        var isSelected = selConn === conn.id;
        var isDragged = dragging && dragging.connId === conn.id;
        var isActive = isSelected || isDragged;

        // 绘制贝塞尔曲线
        ctx.strokeStyle = connColor;
        ctx.lineWidth = isActive ? 3.5 : 2.5;
        ctx.shadowColor = isActive ? connColor : 'transparent';
        ctx.shadowBlur = isActive ? 8 : 0;
        ctx.beginPath();
        ctx.moveTo(fs.x, fs.y);
        ctx.bezierCurveTo(cp1s.x, cp1s.y, cp2s.x, cp2s.y, ts.x, ts.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 端点圆
        var dotR = isActive ? 7 : 5;
        ctx.fillStyle = connColor;
        ctx.beginPath(); ctx.arc(fs.x, fs.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(ts.x, ts.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.stroke();

        // 控制手柄（仅选中/拖拽时可见）
        if (isActive) {
            var isCP1Active = dragging && dragging.which === 'cp1';
            var isCP2Active = dragging && dragging.which === 'cp2';

            // 虚线到控制点
            ctx.strokeStyle = connColor + '88';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(fs.x, fs.y); ctx.lineTo(cp1s.x, cp1s.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(ts.x, ts.y); ctx.lineTo(cp2s.x, cp2s.y); ctx.stroke();
            ctx.setLineDash([]);

            // CP1 手柄
            var r1 = isCP1Active ? 8 : 6;
            ctx.fillStyle = isCP1Active ? '#fff' : connColor;
            ctx.beginPath(); ctx.arc(cp1s.x, cp1s.y, r1, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = isCP1Active ? connColor : '#fff';
            ctx.lineWidth = isCP1Active ? 2.5 : 1.5;
            ctx.stroke();

            // CP2 手柄
            var r2 = isCP2Active ? 8 : 6;
            ctx.fillStyle = isCP2Active ? '#fff' : connColor;
            ctx.beginPath(); ctx.arc(cp2s.x, cp2s.y, r2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = isCP2Active ? connColor : '#fff';
            ctx.lineWidth = isCP2Active ? 2.5 : 1.5;
            ctx.stroke();
        }

        // 条件标签
        var mt = 0.5;
        var mx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var my = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;

        var label = conn.condition || '点击编辑条件';
        ctx.font = 'bold 12px "Segoe UI",system-ui,sans-serif';
        var tw = ctx.measureText(label).width + 16;

        ctx.fillStyle = connColor + (isActive ? 'ee' : 'cc');
        SMTool._roundRect(ctx, mx - tw / 2, my - 12, tw, 24, 12);
        ctx.fill();
        ctx.strokeStyle = connColor;
        ctx.lineWidth = 1;
        SMTool._roundRect(ctx, mx - tw / 2, my - 12, tw, 24, 12);
        ctx.stroke();

        ctx.fillStyle = isActive ? '#fff' : '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my);
    }

    // 正在连线时的预览
    if (SMData.connecting) {
        var c = SMData.connecting;
        var sp = SMTool.worldToCanvas(c.sx, c.sy);
        ctx.strokeStyle = '#7c5ce7';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        var dx = Math.abs(c.mx - sp.x);
        var cpo = Math.max(dx * 0.5, 50);
        ctx.bezierCurveTo(sp.x + cpo, sp.y, c.mx - cpo, c.my, c.mx, c.my);
        ctx.stroke();
        ctx.setLineDash([]);
    }
};

// ---- 获取状态连接点位置 ----
SMTool._getStateConnectorPos = function (node, stateName, type) {
    var el = SMTool._getEl(node.id);
    if (!el) return null;

    var stateEl = el.querySelector('.state-row[data-state="' + CSS.escape(stateName) + '"]');
    var dot = stateEl ? stateEl.querySelector('.conn-dot.' + (type === 'output' ? 'output' : 'input')) : null;
    if (dot) {
        var r = dot.getBoundingClientRect();
        return SMTool.canvasToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    var rect = el.getBoundingClientRect();
    return SMTool.canvasToWorld(
        type === 'output' ? rect.right : rect.left,
        rect.top + rect.height / 2
    );
};

// ---- 默认贝塞尔控制点偏移 ----
SMTool._defaultCPOffsets = function (fp, tp) {
    var dx = tp.x - fp.x;
    var dy = tp.y - fp.y;
    var len = Math.max(Math.abs(dx) * 0.4, 30 / SMData.view.zoom);
    var sign = dx >= 0 ? 1 : -1;
    return { cp1x: len * sign, cp1y: 0, cp2x: -len * sign, cp2y: 0 };
};

// ---- 查找指定屏幕位置附近的控制点 ----
SMTool._findCP = function (sx, sy, radius) {
    radius = radius || 12;
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        var fn = SMData.nodes.get(c.fromNode);
        var tn = SMData.nodes.get(c.toNode);
        if (!fn || !tn) continue;

        var fp = SMTool._getStateConnectorPos(fn, c.fromState, 'output');
        var tp = SMTool._getStateConnectorPos(tn, c.toState, 'input');
        if (!fp || !tp) continue;

        var cp1x = c.cp1x !== undefined ? c.cp1x : 50;
        var cp1y = c.cp1y !== undefined ? c.cp1y : 0;
        var cp2x = c.cp2x !== undefined ? c.cp2x : -50;
        var cp2y = c.cp2y !== undefined ? c.cp2y : 0;

        var cp1s = SMTool.worldToCanvas(fp.x + cp1x, fp.y + cp1y);
        var cp2s = SMTool.worldToCanvas(tp.x + cp2x, tp.y + cp2y);

        if (Math.sqrt((sx - cp1s.x) * (sx - cp1s.x) + (sy - cp1s.y) * (sy - cp1s.y)) < radius)
            return { connId: c.id, which: 'cp1' };
        if (Math.sqrt((sx - cp2s.x) * (sx - cp2s.x) + (sy - cp2s.y) * (sy - cp2s.y)) < radius)
            return { connId: c.id, which: 'cp2' };
    }
    return null;
};

// ---- 碰撞检测 ----
SMTool._hitTest = function (node, wx, wy) {
    var el = SMTool._getEl(node.id);
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return wx >= node.x && wx <= node.x + r.width / SMData.view.zoom &&
           wy >= node.y && wy <= node.y + r.height / SMData.view.zoom;
};
