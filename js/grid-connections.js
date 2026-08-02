/* ================================================================
   网格背景 & 贝塞尔连线渲染
   负责: Canvas 网格背景绘制、节点间的贝塞尔曲线连线渲染
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

SMTool._invalidateConnectorLayout = function (node) {
    if (!node) return;
    node._connectorLayoutRevision = (node._connectorLayoutRevision || 0) + 1;
    SMData._forceRedraw = true;
};

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

    ctx.strokeStyle = base >= 200 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = ox; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (var y = oy; y < h; y += s) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // 中心十字线
    var cx = w / 2 + vx * z;
    var cy = h / 2 + vy * z;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
    var mixControls = [];
    var canvasW = SMTool.connCanvas.width;
    var canvasH = SMTool.connCanvas.height;

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

        // 视口外连线不参与绘制和控件布局；控制点包围盒在视口外时曲线也不可能穿过视口。
        var cullMargin = 140;
        var curveMinX = Math.min(fs.x, ts.x, cp1s.x, cp2s.x);
        var curveMaxX = Math.max(fs.x, ts.x, cp1s.x, cp2s.x);
        var curveMinY = Math.min(fs.y, ts.y, cp1s.y, cp2s.y);
        var curveMaxY = Math.max(fs.y, ts.y, cp1s.y, cp2s.y);
        if (curveMaxX < -cullMargin || curveMinX > canvasW + cullMargin ||
            curveMaxY < -cullMargin || curveMinY > canvasH + cullMargin) continue;

        // 连线颜色
        var connColor = conn.color || _connColor(i);
        var isSelected = selConn === conn.id;
        var isDragged = dragging && dragging.connId === conn.id;
        var isActive = isSelected || isDragged;
        var z = SMData.view.zoom;  // 缩放因子

        // 焦点模式：流程面板高亮 > 选中节点直接相关连线
        var focusNodes = SMData._focusNodes;
        var flowFocus = SMData._flowFocus;
        var inFocus;
        if (flowFocus) {
            // 流程面板高亮模式：仅高亮指定连线
            inFocus = flowFocus.connIds.has(conn.id);
        } else {
            inFocus = !focusNodes || !focusNodes.size || (
                focusNodes.has(conn.fromNode) && focusNodes.has(conn.toNode) &&
                (SMData.selectedNodes.has(conn.fromNode) || SMData.selectedNodes.has(conn.toNode))
            );
        }

        // 绘制贝塞尔曲线
        ctx.globalAlpha = inFocus ? 1 : 0.25;
        ctx.strokeStyle = inFocus ? connColor : '#666';
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
        ctx.fillStyle = inFocus ? connColor : '#666';
        ctx.beginPath(); ctx.arc(fs.x, fs.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 2 * z); ctx.stroke();
        ctx.beginPath(); ctx.arc(ts.x, ts.y, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;

        // 方向箭头始终展示，缩放/拖拽期间也不改变视觉交互方式。
        if (!inFocus) ctx.globalAlpha = 0.25;
        SMTool._drawBezierArrows(ctx, fs.x, fs.y, cp1s.x, cp1s.y, cp2s.x, cp2s.y, ts.x, ts.y, inFocus ? connColor : '#666', isActive, z);
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

        // 条件标签（带换行/截断）—— 尺寸随画布缩放
        // 仅出口节点的连线不显示条件标签；_hideLabel 标记也跳过
        var isExitConn = (fn.nodeType === 'exit' || tn.nodeType === 'exit');
        if (!isExitConn && !conn._hideLabel) {
        if (!inFocus) ctx.globalAlpha = 0.25;
        var rawLabel = conn.condition || '条件';
        var maxCharsPerLine = 20;
        var maxTotalChars = 50;
        var truncated = rawLabel.length > maxTotalChars;
        var displayText = truncated ? rawLabel.substring(0, maxTotalChars) + '...' : rawLabel;

        // 标签中心点（贝塞尔曲线 t=0.5 位置）
        var mt = 0.5;
        var mx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var my = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;

        // 缩放因子
        // ★ 条件框随画布缩小线性放大：z=1.0→1x, z=0.10→1.6x，最大 1.6x
        var extraScale = 1 + 0.6 * Math.max(0, (1 - z) / 0.9);
        if (extraScale > 1.6) extraScale = 1.6;
        var fontSize = Math.round(73 * z * extraScale);
        var lineHeight = Math.round(88 * z * extraScale);
        var padX = Math.round(104 * z * extraScale);
        var padY = Math.round(52 * z * extraScale);
        var textOffY = Math.round(26 * z * extraScale);  // padY/2 居中

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

        // 条件框视觉保持原样；只把删除图标的实际点击热区缩为原来的 20%。
        var closeVisualSize = Math.round(72 * z * extraScale);
        var closeCenterX = rectX + tw - closeVisualSize / 2 - 2;
        var closeCenterY = rectY + closeVisualSize / 2 + 2;
        var closeSize = Math.max(6, Math.round(closeVisualSize * 0.2));
        var closeX = closeCenterX - closeSize / 2;
        var closeY = closeCenterY - closeSize / 2;
        if (!SMData._labelRects) SMData._labelRects = [];
        SMData._labelRects.push({
            connId: conn.id,
            x: rectX, y: rectY, w: tw, h: th,
            rawLabel: rawLabel,
            truncated: truncated,
            closeX: closeX, closeY: closeY, closeW: closeSize, closeH: closeSize
        });

        ctx.fillStyle = '#282830';
        var br = Math.round(21 * z * extraScale);
        SMTool._roundRect(ctx, rectX, rectY, tw, th, br);
        ctx.fill();
        ctx.strokeStyle = connColor;
        ctx.lineWidth = Math.max(1.5, 2 * z);
        SMTool._roundRect(ctx, rectX, rectY, tw, th, br);
        ctx.stroke();

        // ★ 删除图标（右上角 ×）
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = Math.round(48 * z * extraScale) + 'px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('×', closeCenterX, closeCenterY);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var li2 = 0; li2 < lines.length; li2++) {
            ctx.fillText(lines[li2], mx, rectY + textOffY + li2 * lineHeight + lineHeight / 2);
        }
        mixControls.push({
            connId: conn.id,
            x: rectX,
            y: rectY + th + Math.max(3, Math.round(10 * z * extraScale)),
            w: tw,
            h: th,
            fontSize: Math.max(4, Math.round(22 * z * extraScale)),
            color: connColor,
            radius: br,
            compact: tw < 150 || th < 36,
            dimmed: !inFocus,
            value: SMTool._normalizeConnectionMixDuration(conn._mixDuration)
        });
        }  // closes if (!isEntryExitConn)
    }
    ctx.globalAlpha = 1;
    // 连续视口操作时，Canvas 连线仍逐帧更新；输入控件 DOM 限制为约 30fps，
    // 防止大量混合框样式写入挤占浮窗的下一帧。
    var hotView = SMData._viewGesture && SMData._viewGesture.active;
    var mixSyncNow = performance.now();
    if (!hotView || mixSyncNow - (SMTool._lastMixControlSyncAt || 0) >= 34) {
        SMTool._lastMixControlSyncAt = mixSyncNow;
        SMTool._syncConnectionMixControls(mixControls);
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

SMTool._normalizeConnectionMixDuration = function (value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) n = 0;
    return Math.round(n * 10) / 10;
};

SMTool._getConnectionMixDuration = function (fromNodeId, toNodeId) {
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (c.fromNode === fromNodeId && c.toNode === toNodeId) {
            return SMTool._normalizeConnectionMixDuration(c._mixDuration);
        }
    }
    return 0;
};

SMTool._setConnectionMixDuration = function (connId, value) {
    var normalized = SMTool._normalizeConnectionMixDuration(value);
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === connId) {
            SMData.connections[i]._mixDuration = normalized;
            break;
        }
    }
    var inputs = document.querySelectorAll('[data-conn-mix-id="' + connId + '"]');
    for (var ii = 0; ii < inputs.length; ii++) {
        if (document.activeElement !== inputs[ii]) inputs[ii].value = normalized.toFixed(1);
    }
    SMData._forceRedraw = true;
    return normalized;
};

SMTool._adjustConnectionMixDuration = function (connId, delta) {
    var current = 0;
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === connId) {
            current = SMData.connections[i]._mixDuration;
            break;
        }
    }
    return SMTool._setConnectionMixDuration(connId, Number(current || 0) + Number(delta || 0));
};

// 条件框仍由 Canvas 绘制；可输入的混合值使用轻量 DOM 覆盖层，并复用元素避免拖动画布时反复创建。
SMTool._syncConnectionMixControls = function (descriptors) {
    var layer = document.getElementById('connectionControlLayer');
    if (!layer) return;
    layer.style.visibility = '';
    layer.style.pointerEvents = '';
    if (!SMTool._connectionMixElements) SMTool._connectionMixElements = {};
    var elementMap = SMTool._connectionMixElements;
    var keep = {};
    for (var i = 0; i < descriptors.length; i++) {
        var d = descriptors[i];
        keep[d.connId] = true;
        var el = elementMap[d.connId];
        if (!el) {
            el = document.createElement('div');
            el.className = 'mix-transition-box';
            el.setAttribute('data-conn-id', d.connId);
            el.innerHTML = '<span class="mix-transition-title">混合过渡</span>' +
                '<button type="button" data-action="decrease" title="减少 0.1 秒">◀</button>' +
                '<input type="number" min="0" step="0.1" inputmode="decimal" aria-label="混合过渡秒数">' +
                '<button type="button" data-action="increase" title="增加 0.1 秒">▶</button>' +
                '<span class="mix-transition-unit">s</span>';
            (function (box, id) {
                box.addEventListener('mousedown', function (e) { e.stopPropagation(); });
                box.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var action = e.target && e.target.getAttribute('data-action');
                    if (action === 'decrease') SMTool._adjustConnectionMixDuration(id, -0.1);
                    if (action === 'increase') SMTool._adjustConnectionMixDuration(id, 0.1);
                });
                var field = box.querySelector('input');
                field.setAttribute('data-conn-mix-id', id);
                field.addEventListener('change', function () { this.value = SMTool._setConnectionMixDuration(id, this.value).toFixed(1); });
                field.addEventListener('keydown', function (e) {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); this.value = SMTool._adjustConnectionMixDuration(id, -0.1).toFixed(1); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); this.value = SMTool._adjustConnectionMixDuration(id, 0.1).toFixed(1); }
                });
            })(el, d.connId);
            layer.appendChild(el);
            elementMap[d.connId] = el;
        }
        // 仅写入真正变化的样式；位置使用 transform，避免 left/top 触发布局级联。
        var geometrySignature = [
            Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10,
            Math.round(d.w * 10) / 10, Math.round(d.h * 10) / 10,
            d.fontSize, d.color || '', d.radius || 0, d.dimmed ? 1 : 0, d.compact ? 1 : 0
        ].join('|');
        if (el._geometrySignature !== geometrySignature) {
            el._geometrySignature = geometrySignature;
            el.style.left = '0px';
            el.style.top = '0px';
            el.style.transform = 'translate3d(' + d.x + 'px,' + d.y + 'px,0)';
            el.style.width = Math.max(1, d.w) + 'px';
            el.style.height = Math.max(1, d.h) + 'px';
            el.style.fontSize = d.fontSize + 'px';
            el.style.borderColor = d.color || '';
            el.style.borderRadius = Math.max(2, d.radius || 0) + 'px';
            el.classList.toggle('is-dimmed', !!d.dimmed);
            el.classList.toggle('is-compact', !!d.compact);
        }
        var input = el._mixInput || el.querySelector('input');
        el._mixInput = input;
        if (input && document.activeElement !== input) {
            input.value = d.value.toFixed(1);
        }
    }
    var ids = Object.keys(elementMap);
    for (var j = 0; j < ids.length; j++) {
        var id = ids[j];
        if (!keep[id]) {
            if (elementMap[id] && elementMap[id].parentNode) elementMap[id].remove();
            delete elementMap[id];
        }
    }
};

// ---- 吸附对齐紫线渲染 ----
SMTool._renderSnapLines = function () {
    var ctx = SMTool.connCtx;
    var w = SMTool.connCanvas.width;
    var h = SMTool.connCanvas.height;
    var z = SMData.view.zoom;

    for (var i = 0; i < SMData._snapLines.length; i++) {
        var sl = SMData._snapLines[i];
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        if (sl.dir === 'v') {
            // 竖向紫线（贯穿全屏 X 方向）
            var sx = SMTool.worldToCanvas(sl.pos, 0).x;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
        } else {
            // 横向紫线（贯穿全屏 Y 方向）
            var sy = SMTool.worldToCanvas(0, sl.pos).y;
            ctx.moveTo(0, sy);
            ctx.lineTo(w, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }
};
// ---- 获取状态连接点位置 ----
// 首次从 DOM 测量端点相对节点的世界坐标，后续拖拽/缩放/平移直接用模型坐标计算。
// 大量连线时可消除每帧数百次 getBoundingClientRect() 引发的强制同步布局。
SMTool._getStateConnectorPos = function (node, stateName, type) {
    var el = SMTool._getEl(node.id);
    if (!el) return null;
    if (!SMTool._connectorLocalCache) SMTool._connectorLocalCache = {};
    var cacheKey = node.id + '|' + String(stateName || '') + '|' + type;
    var nodeScale = node._customScale !== undefined ? node._customScale : 1;
    var layoutRevision = node._connectorLayoutRevision || 0;
    var cached = SMTool._connectorLocalCache[cacheKey];
    // 层级节点的输入和分层输出都跟随动态行布局；层列表内容/高度可在后台刷新，
    // 不能复用旧的局部坐标。这里只实时测量少量 layer 端点，普通动画端点仍走缓存。
    var dynamicLayerConnector = node.nodeType === 'layer';
    var stableDuringViewGesture = SMData._viewGesture && SMData._viewGesture.active;
    if ((!dynamicLayerConnector || stableDuringViewGesture) && cached && cached.root === el &&
        cached.scale === nodeScale && cached.revision === layoutRevision) {
        return { x: node.x + cached.dx, y: node.y + cached.dy };
    }

    function measure(target, edge) {
        if (!target) return null;
        var rect = target.getBoundingClientRect();
        var sx = rect.left + rect.width / 2;
        var sy = rect.top + rect.height / 2;
        if (edge === 'left') sx = rect.left;
        if (edge === 'right') sx = rect.right;
        var world = SMTool.canvasToWorld(sx, sy);
        SMTool._connectorLocalCache[cacheKey] = {
            root: el,
            scale: nodeScale,
            revision: layoutRevision,
            dx: world.x - node.x,
            dy: world.y - node.y
        };
        return world;
    }

    var dot = null;
    if (node.nodeType === 'exit' && type === 'output') return null;
    if (node.nodeType === 'layer' && type === 'output') {
        var layerNum = 0;
        if (typeof stateName === 'string' && stateName.indexOf('layer_') === 0) {
            layerNum = parseInt(stateName.replace('layer_', '')) || 0;
        }
        if (layerNum > 0) dot = el.querySelector('.layer-dot-' + layerNum);
        if (!dot) dot = el.querySelector('.layer-dot');
        return measure(dot);
    }

    var bar = el.querySelector('.anim-bar');
    dot = bar ? bar.querySelector('.conn-dot.' + (type === 'output' ? 'output' : 'input')) : null;
    if (dot) return measure(dot);

    // 少数无端点的旧工程节点沿用节点边缘回退。
    return measure(el, type === 'output' ? 'right' : 'left');
};

// ---- 在贝塞尔曲线上绘制方向箭头 ----
// 在 t=1/6 和 t=4/6 位置绘制箭头，避免被条件框遮挡
SMTool._drawBezierArrows = function (ctx, x0, y0, x1, y1, x2, y2, x3, y3, color, isActive, z) {
    z = z || 1;
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
    // 控制柄只为当前选中/正在拖拽的连线显示，因此无需扫描全部连线。
    var activeConnId = SMData.draggingCP ? SMData.draggingCP.connId : SMData.selectedConnection;
    if (activeConnId === null || activeConnId === undefined) return null;
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (c.id !== activeConnId) continue;
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
        // ★ 排除关闭按钮区域：点击 × 不触发标签拖拽，交给 _checkConditionClick 处理删除
        if (lr.closeX !== undefined &&
            sx >= lr.closeX && sx <= lr.closeX + lr.closeW &&
            sy >= lr.closeY && sy <= lr.closeY + lr.closeH) {
            continue;
        }
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
