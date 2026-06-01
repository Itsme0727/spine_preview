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
    SMData._labelRects = [];  // 重置标签区域列表

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
        var z = SMData.view.zoom;  // 缩放因子

        // 焦点模式：非直接连线贝塞尔曲线置灰
        var focusNodes = SMData._focusNodes;
        var inFocus = !focusNodes || !focusNodes.size || (focusNodes.has(conn.fromNode) && focusNodes.has(conn.toNode));

        // 绘制贝塞尔曲线
        ctx.globalAlpha = inFocus ? 1 : 0.12;
        ctx.strokeStyle = inFocus ? connColor : '#888';
        ctx.lineWidth = Math.max(1.5, (isActive ? 3.5 : 2.5) * z);
        ctx.shadowColor = isActive ? connColor : 'transparent';
        ctx.shadowBlur = isActive ? 8 * z : 0;
        ctx.beginPath();
        ctx.moveTo(fs.x, fs.y);
        ctx.bezierCurveTo(cp1s.x, cp1s.y, cp2s.x, cp2s.y, ts.x, ts.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 端点圆（随缩放）
        var dotR = Math.round((isActive ? 14 : 10) * z);
        ctx.fillStyle = inFocus ? connColor : '#888';
        ctx.beginPath(); ctx.arc(fs.x, fs.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 2 * z); ctx.stroke();
        ctx.beginPath(); ctx.arc(ts.x, ts.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;

        // 方向箭头（1/3 和 2/3 位置）
        if (!inFocus) ctx.globalAlpha = 0.12;
        SMTool._drawBezierArrows(ctx, fs.x, fs.y, cp1s.x, cp1s.y, cp2s.x, cp2s.y, ts.x, ts.y, inFocus ? connColor : '#888', isActive, z);
        ctx.globalAlpha = 1;

        // 控制手柄（仅选中/拖拽时可见）
        if (isActive) {
            var isCP1Active = dragging && dragging.which === 'cp1';
            var isCP2Active = dragging && dragging.which === 'cp2';

            // 虚线到控制点
            ctx.strokeStyle = connColor + '88';
            ctx.lineWidth = Math.max(1, 1.5 * z);
            ctx.setLineDash([3 * z, 3 * z]);
            ctx.beginPath(); ctx.moveTo(fs.x, fs.y); ctx.lineTo(cp1s.x, cp1s.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(ts.x, ts.y); ctx.lineTo(cp2s.x, cp2s.y); ctx.stroke();
            ctx.setLineDash([]);

            // CP1 手柄
            var r1 = Math.round((isCP1Active ? 8 : 6) * z);
            ctx.fillStyle = isCP1Active ? '#fff' : connColor;
            ctx.beginPath(); ctx.arc(cp1s.x, cp1s.y, r1, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = isCP1Active ? connColor : '#fff';
            ctx.lineWidth = Math.max(1, (isCP1Active ? 2.5 : 1.5) * z);
            ctx.stroke();

            // CP2 手柄
            var r2 = Math.round((isCP2Active ? 8 : 6) * z);
            ctx.fillStyle = isCP2Active ? '#fff' : connColor;
            ctx.beginPath(); ctx.arc(cp2s.x, cp2s.y, r2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = isCP2Active ? connColor : '#fff';
            ctx.lineWidth = Math.max(1, (isCP2Active ? 2.5 : 1.5) * z);
            ctx.stroke();
        }

        // 条件标签（文本节点连线不显示条件框）
        if (conn.fromState !== 'text' && conn.toState !== 'text') {
            if (!inFocus) ctx.globalAlpha = 0.12;
            var rawLabel = conn.condition || '条件';
            var maxCharsPerLine = 20;
        var maxTotalChars = 50;
        var truncated = rawLabel.length > maxTotalChars;
        var displayText = truncated ? rawLabel.substring(0, maxTotalChars) + '...' : rawLabel;

        // 标签中心点（贝塞尔曲线 t=0.5 位置）
        var mt = 0.5;
        var mx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var my = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;

        // 缩放因子（标签大小跟随画布缩放）
        var fontSize = Math.round(28 * z);
        var lineHeight = Math.round(40 * z);
        var padX = Math.round(40 * z);
        var padY = Math.round(28 * z);
        var textOffY = Math.round(16 * z);

        // 将显示文本按 maxCharsPerLine 拆分成多行
        var lines = [];
        var remaining = displayText;
        while (remaining.length > 0) {
            if (remaining.length <= maxCharsPerLine) {
                lines.push(remaining);
                break;
            }
            // 找合适的断点（优先在标点或空格处断）
            var cut = maxCharsPerLine;
            for (var cc = maxCharsPerLine; cc >= maxCharsPerLine - 5 && cc > 0; cc--) {
                var ch = remaining.charAt(cc - 1);
                if (ch === ' ' || ch === '，' || ch === '。' || ch === '、' || ch === '；' || ch === '：' || ch === '\n') {
                    cut = cc;
                    break;
                }
            }
            lines.push(remaining.substring(0, cut));
            remaining = remaining.substring(cut);
            // 去掉行首空格
            if (remaining.charAt(0) === ' ') remaining = remaining.substring(1);
        }

        ctx.font = '300 ' + fontSize + 'px "Segoe UI",system-ui,sans-serif';
        var maxLineW = 0;
        for (var li = 0; li < lines.length; li++) {
            var lw = ctx.measureText(lines[li]).width;
            if (lw > maxLineW) maxLineW = lw;
        }
        var tw = maxLineW + padX;
        var th = lines.length * lineHeight + padY;
        var rectX = mx - tw / 2;
        var rectY = my - th / 2;

        // 存储标签矩形区域供 hover 检测（屏幕坐标，用于 mouse 匹配）
        if (!SMData._labelRects) SMData._labelRects = [];
        SMData._labelRects.push({
            connId: conn.id,
            x: rectX, y: rectY, w: tw, h: th,
            rawLabel: rawLabel,
            truncated: truncated
        });

        ctx.fillStyle = '#1c1c28';  // 黑灰背景
        var br = Math.round(8 * z);  // 圆角随缩放
        SMTool._roundRect(ctx, rectX, rectY, tw, th, br);
        ctx.fill();
        ctx.strokeStyle = connColor;
        ctx.lineWidth = Math.max(1.5, 2 * z);  // 线宽随缩放
        SMTool._roundRect(ctx, rectX, rectY, tw, th, br);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';  // 白色文字
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var li2 = 0; li2 < lines.length; li2++) {
            ctx.fillText(lines[li2], mx, rectY + textOffY + li2 * lineHeight);
        }
        }  // end if (!textNode)
        ctx.globalAlpha = 1;
    }

    // 正在连线时的预览
    if (SMData.connecting) {
        var c = SMData.connecting;
        var sp = SMTool.worldToCanvas(c.sx, c.sy);
        ctx.strokeStyle = '#7c5ce7';
        ctx.lineWidth = Math.max(1, 2 * SMData.view.zoom);
        ctx.setLineDash([6 * SMData.view.zoom, 4 * SMData.view.zoom]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        var dx = Math.abs(c.mx - sp.x);
        var cpo = Math.max(dx * 0.5, 50);
        ctx.bezierCurveTo(sp.x + cpo, sp.y, c.mx - cpo, c.my, c.mx, c.my);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 框选虚线矩形
    if (SMData.marqueeActive) {
        var mx1 = Math.min(SMData.marqueeStart.x, SMData.marqueeEnd.x);
        var my1 = Math.min(SMData.marqueeStart.y, SMData.marqueeEnd.y);
        var mx2 = Math.max(SMData.marqueeStart.x, SMData.marqueeEnd.x);
        var my2 = Math.max(SMData.marqueeStart.y, SMData.marqueeEnd.y);

        ctx.fillStyle = 'rgba(74, 144, 217, 0.08)';
        ctx.fillRect(mx1, my1, mx2 - mx1, my2 - my1);

        ctx.strokeStyle = '#4a90d9';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(mx1, my1, mx2 - mx1, my2 - my1);
        ctx.setLineDash([]);
    }
};

// ---- 获取状态连接点位置 ----
SMTool._getStateConnectorPos = function (node, stateName, type) {
    var el = SMTool._getEl(node.id);
    if (!el) return null;

    // 在新布局中，连接点在 anim-bar 上
    var bar = el.querySelector('.anim-bar');
    var dot = bar ? bar.querySelector('.conn-dot.' + (type === 'output' ? 'output' : 'input')) : null;
    if (dot) {
        var r = dot.getBoundingClientRect();
        return SMTool.canvasToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    // 回退：使用节点边缘
    var rect = el.getBoundingClientRect();
    return SMTool.canvasToWorld(
        type === 'output' ? rect.right : rect.left,
        rect.top + rect.height / 2
    );
};

// ---- 在贝塞尔曲线上绘制方向箭头 ----
// 在 t=1/6 和 t=4/6 位置绘制箭头，避免被条件框遮挡
SMTool._drawBezierArrows = function (ctx, x0, y0, x1, y1, x2, y2, x3, y3, color, isActive, z) {
    z = z || 1;
    // 100%缩放保持原始大小，缩小时箭头轻微反向放大
    var arrowSize = (isActive ? 26 : 21) * z;
    var positions = [1 / 6, 5 / 6];
    for (var p = 0; p < positions.length; p++) {
        var t = positions[p];
        // 贝塞尔曲线上的点 (t)
        var px = Math.pow(1 - t, 3) * x0 + 3 * Math.pow(1 - t, 2) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t * x3;
        var py = Math.pow(1 - t, 3) * y0 + 3 * Math.pow(1 - t, 2) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t * y3;
        // 切线方向（导数）
        var tx = -3 * Math.pow(1 - t, 2) * x0 + 3 * (Math.pow(1 - t, 2) - 2 * (1 - t) * t) * x1 + 3 * (2 * (1 - t) * t - t * t) * x2 + 3 * t * t * x3;
        var ty = -3 * Math.pow(1 - t, 2) * y0 + 3 * (Math.pow(1 - t, 2) - 2 * (1 - t) * t) * y1 + 3 * (2 * (1 - t) * t - t * t) * y2 + 3 * t * t * y3;
        var len = Math.sqrt(tx * tx + ty * ty);
        if (len < 0.001) continue;
        tx /= len; ty /= len;

        // 箭头三角形顶点
        var tipX = px + tx * arrowSize * 0.6;
        var tipY = py + ty * arrowSize * 0.6;
        var leftX = px - tx * arrowSize * 0.5 + ty * arrowSize * 0.45;
        var leftY = py - ty * arrowSize * 0.5 - tx * arrowSize * 0.45;
        var rightX = px - tx * arrowSize * 0.5 - ty * arrowSize * 0.45;
        var rightY = py - ty * arrowSize * 0.5 + tx * arrowSize * 0.45;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
    }
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
    radius = (radius || 12) * SMData.view.zoom;  // 随缩放调整命中半径
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

// ---- 查找指定屏幕位置附近的标签矩形 ----
SMTool._findLabel = function (sx, sy) {
    if (!SMData._labelRects) return null;
    for (var i = 0; i < SMData._labelRects.length; i++) {
        var lr = SMData._labelRects[i];
        if (sx >= lr.x && sx <= lr.x + lr.w && sy >= lr.y && sy <= lr.y + lr.h) {
            return lr;
        }
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
