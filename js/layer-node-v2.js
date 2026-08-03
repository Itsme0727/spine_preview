/* ================================================================
   layer-node.js — 层级节点模块（完全分离，不影响旧代码逻辑）
   功能：叠加多层动画骨架，层数决定显示优先级，
   数越小越靠上。独占式右侧端点（每层一个），
   每个端点仅可连一根线，新连线替换旧连线。
   浮窗预览叠加渲染，动画流并行分支播放。

   🔒 [LOCK-L] 本文件中所有标注 [LOCK-L] 的代码段涉及
      并行播放面板的刷新及时性（DOM文字、连线重绘、浮窗预览）。
      修改任何 [LOCK-L] 锁定的代码前必须询问用户同意解锁。
   ================================================================ */

var SMTool = window.SMTool || {};

// ================================================================
// 数据层
// ================================================================

/** 获取或创建层级节点专用数据 */
SMTool._layerData = function (node) {
    if (!node._layerData) {
        node._layerData = {
            layerCount: 2,              // 层数（≥2，整数）
            layers: {}                  // { 1: { animNodeId, animName }, 2: {...}, ... }
        };
    }
    return node._layerData;
};

/**
 * 沿下游连线查找第一个 Spine 动画节点
 * 若直接连线节点不是动画节点（如延时器），继续向右追踪直到找到动画节点
 * 找不到则返回直接连线节点本身
 * @returns {{ animNode, resolvedId, directNodeId }}
 */
SMTool._resolveAnimNodeDownstream = function (startNodeId, maxDepth) {
    maxDepth = maxDepth || 20;
    var visited = new Set();
    var currentId = startNodeId;
    var depth = 0;
    while (depth < maxDepth) {
        if (visited.has(currentId)) break;
        visited.add(currentId);
        var node = SMData.nodes.get(currentId);
        if (!node) break;
        // 找到了 spine 动画节点（有骨架数据和动画列表）
        if (node.nodeType === 'spine' && node.skeletonData && node.animations && node.animations.length > 0) {
            return { animNode: node, resolvedId: currentId, directNodeId: startNodeId };
        }
        // 沿唯一下游连线继续查找
        var nextId = null;
        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (c.fromNode === currentId && !visited.has(c.toNode)) {
                // 跳过回连到 layer 节点的线
                var toNode = SMData.nodes.get(c.toNode);
                if (toNode && toNode.nodeType === 'layer') continue;
                nextId = c.toNode;
                break;
            }
        }
        if (!nextId) break;
        currentId = nextId;
        depth++;
    }
    // 找不到动画节点 → 返回直接连线节点
    var directNode = SMData.nodes.get(startNodeId);
    return { animNode: directNode, resolvedId: startNodeId, directNodeId: startNodeId };
};

// ================================================================
// 创建层级节点
// ================================================================

SMTool.addLayerNode = function () {
    SMTool.addLayerNodeAt(
        Math.random() * 200 - 100 + window.innerWidth / 2,
        Math.random() * 200 - 100 + window.innerHeight / 2
    );
};

SMTool.addLayerNodeAt = function (wx, wy) {
    SMTool.pushUndo();
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.nodeType = 'layer';
    node.name = '并行播放';
    node.x = wx; node.y = wy;
    node.width = 340;
    node._layerData = { layerCount: 2, layers: {} };
    SMData.nodes.set(id, node);
    SMTool._createLayerEl(node);
    SMTool._updatePos(node);
    SMData.selectedNodes.clear();
    SMData.selectedNodes.add(id);
    SMData.selectedNode = id;
    SMTool._updateSel();
    SMTool._updateSB();
};

/** 右键菜单入口 */
SMTool.ctxAddLayer = function () {
    var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
    SMTool.addLayerNodeAt(wp.x, wp.y);
    var cm = document.getElementById('ctxMenu');
    if (cm) cm.style.display = 'none';
};

// ================================================================
// DOM 渲染
// ================================================================

SMTool._createLayerEl = function (node) {
    // ★ 先移除旧 DOM，防止重复创建
    var oldEl = document.getElementById('sn-' + node.id);
    if (oldEl) oldEl.remove();

    var el = document.createElement('div');
    el.id = 'sn-' + node.id;
    el.className = 'spine-node layer-node';
    el.setAttribute('data-id', node.id);

    var ld = SMTool._layerData(node);
    var lc = ld.layerCount;

    // 构建内容框 HTML（每层一个，右侧带端点）
    var contentBoxes = '';
    for (var lj = 1; lj <= lc; lj++) {
        var layerInfo = ld.layers[lj];
        var displayText = '请连线动画节点';
        var animName = '';
        if (layerInfo && layerInfo.animNodeId) {
            // ★ 沿下游查找第一个动画节点（跳过延时器等非动画节点）
            var resolvedInit = SMTool._resolveAnimNodeDownstream(layerInfo.animNodeId);
            var linkedNode = resolvedInit.animNode;
            if (linkedNode) {
                displayText = SMTool._esc(
                    (linkedNode._trackMode ? linkedNode._trackName : '') ||
                    linkedNode.sourceFile || linkedNode.name || '动画节点'
                );
                if (layerInfo.animName) {
                    animName = ' — ' + SMTool._esc(layerInfo.animName);
                }
            }
        }
        contentBoxes += '<div class="layer-box-row" data-layer="' + lj + '">' +
            '<div class="layer-box' + (layerInfo && layerInfo.animNodeId ? ' connected' : '') + '">' +
                '<span class="layer-box-num">L' + lj + '</span>' +
                '<span class="layer-box-text">' + displayText + animName + '</span>' +
            '</div>' +
            '<div class="layer-arrows">' +
                '<button class="layer-arrow-btn layer-arrow-up" data-action="moveUp" title="上移">▲</button>' +
                '<button class="layer-arrow-btn layer-arrow-down" data-action="moveDown" title="下移">▼</button>' +
            '</div>' +
            '<div class="conn-dot output layer-dot layer-dot-' + lj + '" ' +
                'onclick="event.stopPropagation();SMTool._onLayerDot(' + node.id + ',' + lj + ',\'output\')" ' +
                'title="第' + lj + '层连线输出（独占）"></div>' +
            '</div>';
    }

    el.innerHTML =
        '<div class="header layer-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
            '<span class="layer-title">📚 并行播放</span>' +
            '<div class="layer-header-btns">' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="layer-body">' +
            '<div class="layer-count-row">' +
                '<span class="layer-count-label">层数</span>' +
                '<button class="layer-count-btn" onclick="event.stopPropagation();SMTool._layerCountStep(' + node.id + ',-1)" onkeydown="event.stopPropagation()">◀</button>' +
                '<input type="number" class="layer-count-input" value="' + lc + '" min="2" step="1" ' +
                    'onchange="event.stopPropagation();SMTool._layerCountSet(' + node.id + ',parseInt(this.value)||2)" ' +
                    'onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">' +
                '<button class="layer-count-btn" onclick="event.stopPropagation();SMTool._layerCountStep(' + node.id + ',1)" onkeydown="event.stopPropagation()">▶</button>' +
                '<span class="layer-count-unit">层</span>' +
            '</div>' +
            '<div class="layer-boxes">' + contentBoxes + '</div>' +
        '</div>' +
        '<div class="anim-bar layer-anim-bar">' +
            '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'layer\',\'input\')" title="连线输入"></div>' +
            '<span style="flex:1"></span>' +
        '</div>' +
        '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';

    SMTool.nodesLayer.appendChild(el);

    // ★ 初始化层拖拽排序 + 点击选中
    SMTool._initLayerDrag(el, node);
};

/** 更新层级节点 DOM（连线变化时调用） */
SMTool._updateLayerEl = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el || node.nodeType !== 'layer') return;
    if (typeof SMTool._invalidateConnectorLayout === 'function') SMTool._invalidateConnectorLayout(node);
    var ld = SMTool._layerData(node);

    // 更新内容框
    var boxes = el.querySelectorAll('.layer-box');
    for (var li = 0; li < boxes.length; li++) {
        var lnum = li + 1;
        var layerInfo = ld.layers[lnum];
        var textEl = boxes[li].querySelector('.layer-box-text');
        if (textEl) {
            var displayText = '请连线动画节点';
            var animName = '';
            if (layerInfo && layerInfo.animNodeId) {
                // ★ 沿下游查找第一个动画节点（跳过延时器等非动画节点）
                var resolved = SMTool._resolveAnimNodeDownstream(layerInfo.animNodeId);
                var linkedNode = resolved.animNode;
                if (linkedNode) {
                    displayText = SMTool._esc(
                        (linkedNode._trackMode ? linkedNode._trackName : '') ||
                        linkedNode.sourceFile || linkedNode.name || '动画节点'
                    );
                    if (layerInfo.animName) {
                        animName = ' — ' + SMTool._esc(layerInfo.animName);
                    }
                }
            }
            textEl.textContent = displayText + animName;
        }
    }
};

// ================================================================
// 层数控制
// ================================================================

SMTool._layerCountStep = function (nid, dir) {
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'layer') return;
    var ld = SMTool._layerData(node);
    var newCount = ld.layerCount + dir;
    if (newCount < 2) newCount = 2;
    if (newCount > 20) newCount = 20;
    SMTool._layerCountSet(nid, newCount);
};

SMTool._layerCountSet = function (nid, count) {
    // 🔒 [LOCK-L] 并行播放面板刷新及时性 — 层数变更后必须重建 DOM + 刷新盒子文字
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'layer') return;
    count = Math.max(2, Math.min(20, Math.round(count) || 2));
    var ld = SMTool._layerData(node);
    if (ld.layerCount === count) return;

    // 清理超出层的连线
    var connsToRemove = [];
    for (var ci = 0; ci < SMData.connections.length; ci++) {
        var c = SMData.connections[ci];
        if (c.fromNode !== nid) continue;
        var cln = c._layerNum;
        if (!cln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
            cln = parseInt(c.fromState.replace('layer_', '')) || 0;
        }
        if (cln > count) {
            connsToRemove.push(ci);
        }
    }
    for (var ri = connsToRemove.length - 1; ri >= 0; ri--) {
        SMData.connections.splice(connsToRemove[ri], 1);
    }

    // 清理超出层的数据
    for (var lk = count + 1; lk <= ld.layerCount; lk++) {
        delete ld.layers[lk];
    }

    ld.layerCount = count;
    // ★ 兜底：从连线表回填 _layerData（兼容旧数据 _layerNum 缺失）
    var hasData = ld.layers && Object.keys(ld.layers).length > 0;
    if (!hasData) {
        for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
            var c2 = SMData.connections[ci2];
            if (c2.fromNode !== nid) continue;
            var ln2 = c2._layerNum;
            if (!ln2 && typeof c2.fromState === 'string' && c2.fromState.indexOf('layer_') === 0) {
                ln2 = parseInt(c2.fromState.replace('layer_', '')) || 0;
            }
            if (ln2 >= 1 && ln2 <= count) {
                if (!ld.layers) ld.layers = {};
                if (!ld.layers[ln2]) {
                    var tn2 = SMData.nodes.get(c2.toNode);
                    ld.layers[ln2] = { animNodeId: c2.toNode, animName: tn2 && tn2.currentAnim ? tn2.currentAnim : '' };
                    if (!c2._layerNum) c2._layerNum = ln2;
                }
            }
        }
    }
    SMTool._createLayerEl(node);
    SMTool._updatePos(node);
    // ★ 即时刷新
    SMTool._refreshAllLayerBoxes();
    SMTool._refreshLayerPreviewIfOpen(node);
};

// ================================================================
// 独占连线逻辑
// ================================================================

/** 层级节点右侧端点点击 */
SMTool._onLayerDot = function (nid, layerNum, dotType) {
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'layer') return;

    // ★ 自动进入连线模式
    if (!SMData.connectMode) {
        SMData.connectMode = true;
        document.getElementById('btnConnect').classList.add('active');
    }

    // 获取此端点的画布坐标（用于拖拽连线）
    var el = SMTool._getEl(nid);
    if (el) {
        var dotEl = el.querySelector('.layer-dot-' + layerNum);
        if (dotEl) {
            var rect = dotEl.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var wp = SMTool.canvasToWorld(cx, cy);
            SMData.connecting = {
                nodeId: nid,
                stateName: 'layer_' + layerNum,
                dotType: dotType,
                sx: wp.x, sy: wp.y,
                mx: cx, my: cy
            };
            if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(nid);
            SMTool._updateSel();
            return;
        }
    }

    // 回退：无 DOM 信息时仅记录节点
    SMData.connecting = { nodeId: nid, stateName: 'layer_' + layerNum, dotType: dotType };
    if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(nid);
    SMTool._updateSel();
};

/** 连线完成时检查是否为层级节点端点 → 独占替换 */
SMTool._tryConnectLayerDot = function (fromNid, fromState, toNid) {
    var fromNode = SMData.nodes.get(fromNid);
    if (!fromNode || fromNode.nodeType !== 'layer') return false;

    // 解析层号
    var layerNum = 0;
    if (typeof fromState === 'string' && fromState.indexOf('layer_') === 0) {
        layerNum = parseInt(fromState.replace('layer_', '')) || 0;
    }
    if (layerNum <= 0) return false;

    SMTool.pushUndo();

    // ★ 独占替换：先删除此层已有连线
    for (var ci = SMData.connections.length - 1; ci >= 0; ci--) {
        if (SMData.connections[ci].fromNode === fromNid && SMData.connections[ci]._layerNum === layerNum) {
            SMData.connections.splice(ci, 1);
        }
    }

    // 创建新连线
    var connId = SMData.nextConnId++;
    SMData.connections.push({
        id: connId,
        fromNode: fromNid,
        fromState: fromState,
        toNode: toNid,
        toState: '',
        condition: '',
        _mixDuration: 0,
        cp1x: 0, cp1y: 0, cp2x: 0, cp2y: 0,
        _layerNum: layerNum
    });

    // 更新层数据
    var ld = SMTool._layerData(fromNode);
    if (!ld.layers) ld.layers = {};
    ld.layers[layerNum] = { animNodeId: toNid, animName: '' };

    // 同步被连线节点的动画名
    var toNode = SMData.nodes.get(toNid);
    if (toNode && toNode.currentAnim) {
        ld.layers[layerNum].animName = toNode.currentAnim;
    }

    SMTool._updateLayerEl(fromNode);
    // ★ 备用：直接更新 DOM（防止 _updateLayerEl 被缓存旧版本覆盖）
    var el2 = SMTool._getEl(fromNid);
    if (el2) {
        var boxes2 = el2.querySelectorAll('.layer-box-text');
        if (boxes2[layerNum - 1]) {
            // ★ 使用解析后的动画节点（沿下游查找），而非直连节点
            var resolved2 = SMTool._resolveAnimNodeDownstream(toNid);
            var tn2 = resolved2.animNode;
            boxes2[layerNum - 1].textContent = (tn2 ? (tn2.sourceFile || tn2.name || '动画节点') : '?') + (tn2 && tn2.currentAnim ? ' — ' + tn2.currentAnim : '');
        }
    }
    // ★ 即时刷新浮窗预览
    SMTool._refreshLayerPreviewIfOpen(fromNode);
    return true;
};

/** 节点动画变更时同步层数据 */
// 🔒 [LOCK-L] 并行播放面板刷新及时性 — 动画变更时自动同步层级节点显示
SMTool._syncLayerAnim = function (nid) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    // 查找所有引用了此节点的层级节点
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var ln = r.value;
        if (ln.nodeType === 'layer' && ln._layerData && ln._layerData.layers) {
            var ld = ln._layerData;
            var changed = false;
            for (var lk = 1; lk <= ld.layerCount; lk++) {
                if (ld.layers[lk] && ld.layers[lk].animNodeId === nid) {
                    ld.layers[lk].animName = node.currentAnim || '';
                    changed = true;
                }
            }
            if (changed) SMTool._updateLayerEl(ln);
        }
        r = nodesIter.next();
    }
};

/** ★ 立即刷新所有层级节点的盒子文字（连线增/删后调用） */
// ================================================================
// 🔒🔒🔒 [LOCK-L] 并行播放面板刷新及时性 — 不可修改刷新时机/顺序
// ⚠️ 此函数及其所有调用点被锁定。并行播放面板的 DOM 文字、
//    连线重绘、浮窗预览的刷新逻辑与调用时机需保持一致。
//    修改前必须询问用户同意"解锁 LOCK-L"。
// ================================================================
SMTool._refreshAllLayerBoxes = function () {
    // ★ 优化：先按 fromNode 建立连线索引，避免 O(N×C) 嵌套遍历
    var connIndex = {}; // { fromNodeId: { layerNum: { toNode, toNodeObj } } }
    for (var ci = 0; ci < SMData.connections.length; ci++) {
        var c = SMData.connections[ci];
        var ln = c._layerNum;
        if (!ln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
            ln = parseInt(c.fromState.replace('layer_', '')) || 0;
        }
        if (!ln) continue;
        if (!connIndex[c.fromNode]) connIndex[c.fromNode] = {};
        connIndex[c.fromNode][ln] = { toNode: c.toNode, toNodeObj: SMData.nodes.get(c.toNode) };
    }

    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var ln = r.value;
        if (ln.nodeType !== 'layer') { r = nodesIter.next(); continue; }
        var el = SMTool._getEl(ln.id);
        if (!el) { r = nodesIter.next(); continue; }
        // ★ 检测旧版 DOM（缺少 .layer-box-text），自动重建为正确的 layer DOM
        if (!el.classList.contains('layer-node') || el.querySelectorAll('.layer-box-text').length === 0) {
            SMTool._createLayerEl(ln);
            SMTool._updatePos(ln);  // ★ 重建后立即更新位置，防止连线错位
            el = SMTool._getEl(ln.id);
            if (!el) { r = nodesIter.next(); continue; }
        }
        var boxes = el.querySelectorAll('.layer-box-text');
        var ld = SMTool._layerData(ln);
        var nodeConns = connIndex[ln.id] || {};
        for (var li = 0; li < boxes.length; li++) {
            var lnum = li + 1;
            var txt = '请连线动画节点';
            var cinfo = nodeConns[lnum];
            if (cinfo && cinfo.toNodeObj) {
                // ★ 沿下游解析第一个动画节点（跳过延时器等非动画节点）
                var resolvedR = SMTool._resolveAnimNodeDownstream(cinfo.toNode);
                var displayNode = resolvedR.animNode;
                txt = (displayNode ? (displayNode.sourceFile || displayNode.name || '动画节点') : (cinfo.toNodeObj.sourceFile || cinfo.toNodeObj.name || '动画节点')) + (displayNode && displayNode.currentAnim ? ' — ' + displayNode.currentAnim : '');
            } else {
                // ★ 无连线则清除该层的旧数据
                if (ld.layers[lnum]) delete ld.layers[lnum];
            }
            boxes[li].textContent = txt;
            var boxEl = boxes[li].parentElement;
            if (boxEl) boxEl.classList.toggle('connected', !!cinfo);
        }
        r = nodesIter.next();
    }
    // ★ 重建了 DOM → 强制下一帧重绘连线
    SMData._forceRedraw = true;
};

// ================================================================
// 层拖拽排序 + 点击选中
// ================================================================

/** 初始化层行拖拽排序（长按 2 秒进入排序模式，锁定面板位置） */
SMTool._initLayerDrag = function (el, node) {
    var dragNode = node;
    var dragSrcLayer = null;
    var longPressTimer = null;

    // ★ 事件委托：▲▼ 按钮点击
    el.addEventListener('click', function (e) {
        var btn = e.target.closest('.layer-arrow-btn');
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        var row = btn.closest('.layer-box-row');
        if (!row) return;
        var layerNum = parseInt(row.getAttribute('data-layer'));
        var dir = btn.getAttribute('data-action') === 'moveUp' ? -1 : 1;
        SMTool._layerMoveBy(dragNode.id, layerNum, dir);
    });

    function cleanup() {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        SMData._layerReorderActive = false;
        var cur = document.getElementById('sn-' + dragNode.id);
        if (cur) {
            var all = cur.querySelectorAll('.layer-box-row');
            for (var i = 0; i < all.length; i++) {
                all[i].classList.remove('dragging', 'drop-above', 'drop-below');
            }
        }
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
    }

    function onMove(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        var cur = document.getElementById('sn-' + dragNode.id);
        if (!cur) return;
        var rows = cur.querySelectorAll('.layer-box-row');
        var target = null, before = true;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i].getBoundingClientRect();
            if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
                target = rows[i]; before = (ev.clientY < r.top + r.height / 2); break;
            }
        }
        for (var j = 0; j < rows.length; j++) rows[j].classList.remove('drop-above', 'drop-below');
        if (target && !target.classList.contains('dragging')) {
            target.classList.add(before ? 'drop-above' : 'drop-below');
        }
    }

    function onUp(ev) {
        // 🔒 [LOCK-L] 并行播放面板刷新及时性 — drop 位置检测（above/below）+ _layerSwap 调用链
        ev.stopPropagation();
        ev.preventDefault();
        var cur = document.getElementById('sn-' + dragNode.id);
        if (cur) {
            var rows = cur.querySelectorAll('.layer-box-row');
            var target = null, before = true;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i].getBoundingClientRect();
                if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
                    target = rows[i];
                    before = (ev.clientY < r.top + r.height / 2);
                    break;
                }
            }
            if (target) {
                var tgtNum = parseInt(target.getAttribute('data-layer'));
                // ★ drop below → 插入到目标行之后
                if (!before) tgtNum++;
                var lc = dragNode._layerData ? dragNode._layerData.layerCount : 0;
                if (tgtNum > lc) tgtNum = lc;
                if (tgtNum < 1) tgtNum = 1;
                if (tgtNum !== dragSrcLayer) SMTool._layerSwap(dragNode, dragSrcLayer, tgtNum);
            }
        }
        cleanup();
    }

    var rows = el.querySelectorAll('.layer-box-row');
    for (var ri = 0; ri < rows.length; ri++) {
        (function (row) {
            row.addEventListener('mousedown', function (e) {
                if (e.target.closest('.layer-dot')) return;
                if (e.target.closest('.layer-arrow-btn')) return; // ★ 不拦截箭头按钮
                if (e.button !== 0) return;
                e.stopPropagation();

                // 选中
                var all = el.querySelectorAll('.layer-box-row');
                for (var a = 0; a < all.length; a++) all[a].classList.remove('selected');
                row.classList.add('selected');

                // 2 秒长按启动拖拽排序
                var srcLayer = parseInt(row.getAttribute('data-layer'));
                longPressTimer = setTimeout(function () {
                    longPressTimer = null;
                    SMData._layerReorderActive = true;
                    dragSrcLayer = srcLayer;
                    var cur2 = document.getElementById('sn-' + dragNode.id);
                    var cr = cur2 ? cur2.querySelector('.layer-box-row[data-layer="' + srcLayer + '"]') : null;
                    if (cr) cr.classList.add('dragging');
                    // ★ 捕获阶段优先执行 + 阻止其他处理器
                    document.addEventListener('mousemove', onMove, true);
                    document.addEventListener('mouseup', onUp, true);
                }, 500);

                // 提前松手取消
                var earlyUp = function () {
                    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                    document.removeEventListener('mouseup', earlyUp);
                };
                document.addEventListener('mouseup', earlyUp);
            });
        })(rows[ri]);
    }
};

/** 插入式重排序：把 src 层拖到 tgt 层位置，中间层顺移 */
// ================================================================
// 🔒 [LOCK-L] 并行播放面板刷新及时性
// ⚠️ 此函数包含层级数据交换、连线 _layerNum/fromState 更新、
//    DOM 重建、盒子文字刷新、连线画布强制重绘等关键刷新逻辑。
//    修改前必须询问用户同意"解锁 LOCK-L"。
// ================================================================
SMTool._layerSwap = function (layerNode, srcLayer, tgtLayer) {
    if (srcLayer === tgtLayer || srcLayer < 1 || tgtLayer < 1) return;
    SMTool.pushUndo();
    var ld = SMTool._layerData(layerNode);
    var lc = ld.layerCount;
    if (srcLayer > lc || tgtLayer > lc) return;

    // ★ 兜底：从连线表回填 _layerData（兼容旧数据 _layerNum 缺失）
    if (!ld.layers || Object.keys(ld.layers).length === 0) {
        for (var ci0 = 0; ci0 < SMData.connections.length; ci0++) {
            var c0 = SMData.connections[ci0];
            if (c0.fromNode !== layerNode.id) continue;
            var ln0 = c0._layerNum;
            if (!ln0 && typeof c0.fromState === 'string' && c0.fromState.indexOf('layer_') === 0) {
                ln0 = parseInt(c0.fromState.replace('layer_', '')) || 0;
            }
            if (ln0 >= 1 && ln0 <= lc) {
                if (!ld.layers) ld.layers = {};
                if (!ld.layers[ln0]) {
                    var tn0 = SMData.nodes.get(c0.toNode);
                    ld.layers[ln0] = { animNodeId: c0.toNode, animName: tn0 && tn0.currentAnim ? tn0.currentAnim : '' };
                    if (!c0._layerNum) c0._layerNum = ln0;
                }
            }
        }
    }
    if (srcLayer > lc || tgtLayer > lc) return;

    var orderedData = [];
    var orderedConns = [];
    for (var lk = 1; lk <= lc; lk++) {
        var info = ld.layers[lk];
        orderedData.push(info ? { animNodeId: info.animNodeId, animName: info.animName || '' } : null);
        var foundCid = null;
        for (var ci = 0; ci < SMData.connections.length; ci++) {
            var cc = SMData.connections[ci];
            if (cc.fromNode !== layerNode.id) continue;
            var cln = cc._layerNum;
            if (!cln && typeof cc.fromState === 'string' && cc.fromState.indexOf('layer_') === 0) {
                cln = parseInt(cc.fromState.replace('layer_', '')) || 0;
            }
            if (cln === lk) { foundCid = cc.id; break; }
        }
        orderedConns.push(foundCid);
    }

    var movedData = orderedData[srcLayer - 1];
    var movedConn = orderedConns[srcLayer - 1];
    orderedData.splice(srcLayer - 1, 1);
    orderedConns.splice(srcLayer - 1, 1);
    var insertIdx = tgtLayer - 1;
    if (insertIdx < 0) insertIdx = 0;
    if (insertIdx > orderedData.length) insertIdx = orderedData.length;
    orderedData.splice(insertIdx, 0, movedData);
    orderedConns.splice(insertIdx, 0, movedConn);

    ld.layers = {};
    for (var li = 0; li < orderedData.length; li++) {
        if (orderedData[li]) ld.layers[li + 1] = orderedData[li];
    }

    for (var li2 = 0; li2 < orderedConns.length; li2++) {
        var cid = orderedConns[li2];
        if (cid === null) continue;
        for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
            if (SMData.connections[ci2].id === cid) {
                SMData.connections[ci2]._layerNum = li2 + 1;
                SMData.connections[ci2].fromState = 'layer_' + (li2 + 1);
                break;
            }
        }
    }

    SMTool._createLayerEl(layerNode);
    SMTool._updatePos(layerNode);
    SMTool._refreshAllLayerBoxes();
    SMTool._updateSB();
    SMTool._updateStateRowColors();
    SMTool._refreshLayerPreviewIfOpen(layerNode);
    // ★ 强制重绘连线画布（连线 _layerNum/fromState 已变更）
    SMData._forceRedraw = true;
};

/** ★ 若浮窗正在显示该层级节点，立即刷新 */
// 🔒 [LOCK-L] 并行播放面板刷新及时性 — 此刷新调用时机不可随意变更
SMTool._refreshLayerPreviewIfOpen = function (layerNode) {
    var pp = SMData._animPreview;
    if (pp && pp.visible && pp.nodeId === layerNode.id && pp._layerSkeletons && pp._layerSkeletons.length > 0) {
        SMTool._showLayerPreview(layerNode);
    }
};

/** ▲▼ 按钮移动层：dir=-1 上移，dir=1 下移 */
// 🔒 [LOCK-L] 并行播放面板刷新及时性 — 调用 _layerSwap 触发完整刷新链路
SMTool._layerMoveBy = function (nid, layerNum, dir) {
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'layer') return;
    var tgt = layerNum + dir;
    var lc = node._layerData.layerCount;
    if (tgt < 1 || tgt > lc) return;
    SMTool._layerSwap(node, layerNum, tgt);
};

// ================================================================
// 浮窗预览：多层叠加渲染
// ================================================================

// ★ 从指定节点出发，沿 outgoing 连线构建动画链（取第一条边，防环路）
// 返回 [nodeId1, nodeId2, ...] 顺序数组
SMTool._buildChainFromNode = function (startNodeId) {
    var chain = [startNodeId];
    var visited = {};
    visited[startNodeId] = true;
    var currentId = startNodeId;
    while (true) {
        var nextId = null;
        for (var ci = 0; ci < SMData.connections.length; ci++) {
            var c = SMData.connections[ci];
            if (c.fromNode === currentId && !visited[c.toNode]) {
                nextId = c.toNode;
                break;
            }
        }
        if (!nextId) break;
        chain.push(nextId);
        visited[nextId] = true;
        currentId = nextId;
    }
    return chain;
};

// ================================================================
// ★★ 嵌套并行播放树（金字塔模型）— 构建与状态管理
// ================================================================

// 最大嵌套深度（防止无限递归）
var MAX_PLAYBACK_TREE_DEPTH = 5;

/**
 * 为指定并行播放节点构建"播放树"
 * 遍历每层的动画链，遇嵌套并行节点时递归构建子树。
 *
 * 返回结构：
 * {
 *   layerNodeId: <id>,
 *   layers: [{
 *     layerNum: 1,
 *     chainNodeIds: [id1, id2, ...],      // 链上的普通节点 ID（直到遇到嵌套 layer 或链结束）
 *     subLayerNodeId: <id> | null,         // 链末尾如果是嵌套的并行播放节点，记录其 ID
 *     subLayerTree: <playbackTree> | null   // 嵌套并行节点的子树（递归）
 *   }, ...],
 *   depth: 0                               // 嵌套深度（根=0）
 * }
 */
SMTool._buildPlaybackTree = function (layerNode, depth, ancestorIds) {
    if (depth === undefined) depth = 0;
    if (ancestorIds === undefined) ancestorIds = new Set();
    if (depth >= MAX_PLAYBACK_TREE_DEPTH) {
        console.warn('[PlaybackTree] 嵌套深度已达上限(' + MAX_PLAYBACK_TREE_DEPTH + ')，停止递归');
        return null;
    }
    // ★ 循环检测：若当前 layer 节点的 ID 已在祖先链中 → 检测到环路，停止
    if (ancestorIds.has(layerNode.id)) {
        console.warn('[PlaybackTree] 检测到循环引用: #' + layerNode.id + '，已截断');
        return null;
    }
    // 每条递归路径使用独立祖先集合。若直接修改传入 Set，某个兄弟分支访问过的
    // layer 会污染其他分支，导致合法复用被误判为循环引用。
    var lineage = new Set(ancestorIds);
    lineage.add(layerNode.id);

    var ld = SMTool._layerData(layerNode);
    if (!ld || ld.layerCount < 1) return null;

    var tree = {
        layerNodeId: layerNode.id,
        layers: [],
        depth: depth
    };

    for (var lnum = 1; lnum <= ld.layerCount; lnum++) {
        // ★ 获取该层的连线目标节点
        var startNodeId = null;
        for (var ci = 0; ci < SMData.connections.length; ci++) {
            var c = SMData.connections[ci];
            if (c.fromNode !== layerNode.id) continue;
            var cln = (c._layerNum >= 1 && c._layerNum <= ld.layerCount) ? c._layerNum : 0;
            if (!cln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
                cln = parseInt(c.fromState.replace('layer_', '')) || 0;
            }
            if (cln === lnum) {
                startNodeId = c.toNode;
                break;
            }
        }
        // 兜底：从 _layerData 获取
        if (!startNodeId && ld.layers[lnum] && ld.layers[lnum].animNodeId) {
            startNodeId = ld.layers[lnum].animNodeId;
        }

        var layerInfo = {
            layerNum: lnum,
            chainNodeIds: [],
            subLayerNodeId: null,
            subLayerTree: null
        };

        if (startNodeId) {
            // ★ 沿链遍历，直到遇到嵌套 layer 节点或链结束
            var visited = {};
            var currentId = startNodeId;
            var maxSteps = 50;
            while (currentId && maxSteps-- > 0) {
                if (visited[currentId]) break;
                visited[currentId] = true;

                var curNode = SMData.nodes.get(currentId);
                if (!curNode) break;

                // 检测是否是嵌套的并行播放节点
                if (curNode.nodeType === 'layer') {
                    // ★ 链在此暂停，记录嵌套并行节点并构建其子树
                    layerInfo.subLayerNodeId = curNode.id;
                    layerInfo.subLayerTree = SMTool._buildPlaybackTree(curNode, depth + 1, lineage);
                    break;
                }

                // 普通节点：加入链
                layerInfo.chainNodeIds.push(currentId);

                // 查找唯一下游连线
                var nextId = null;
                for (var cj = 0; cj < SMData.connections.length; cj++) {
                    var cc = SMData.connections[cj];
                    if (cc.fromNode === currentId && !visited[cc.toNode]) {
                        nextId = cc.toNode;
                        break;
                    }
                }
                if (!nextId) break;
                currentId = nextId;
            }
        }

        // ★ 即使某层无连线，也保留该层（用于显示"未连线"状态）
        tree.layers.push(layerInfo);
    }

    return tree;
};

// 从播放树递归寻找第一份可渲染 Spine 资源，支持 layer → layer 直接嵌套。
SMTool._findFirstSpineInPlaybackTree = function (tree) {
    if (!tree || !tree.layers) return null;
    for (var li = 0; li < tree.layers.length; li++) {
        var layer = tree.layers[li];
        var ids = layer.chainNodeIds || [];
        for (var ci = 0; ci < ids.length; ci++) {
            var node = SMData.nodes.get(ids[ci]);
            if (node && node.nodeType === 'spine' && node._srcAtlasText &&
                (node._srcSkelJson || node._srcSkelBinBase64) &&
                (node.textureImg || (node._texImgs && node._texImgs.length > 0))) {
                return node;
            }
        }
        var nested = SMTool._findFirstSpineInPlaybackTree(layer.subLayerTree);
        if (nested) return nested;
    }
    return null;
};

/**
 * 判断播放树是否全部完成（递归检查所有层和所有嵌套子树）
 * @returns true=全部完成, false=仍有未完成的层或子树
 */
SMTool._isPlaybackTreeCompleted = function (tree, nodeStates) {
    if (!tree || !tree.layers || tree.layers.length === 0) return true;

    for (var li = 0; li < tree.layers.length; li++) {
        var layer = tree.layers[li];
        var stateKey = 'L' + layer.layerNum;
        var ls = (nodeStates && nodeStates[stateKey]) ? nodeStates[stateKey] : null;

        // 该层有嵌套子树
        if (layer.subLayerNodeId && layer.subLayerTree) {
            var subState = (nodeStates && nodeStates[stateKey + '_subState']) ? nodeStates[stateKey + '_subState'] : null;
            // 检查主链是否播完（所有 chainNodeIds 都走完了，chainIdx >= chainNodeIds.length）
            var chainDone = ls ? (ls.chainIdx >= layer.chainNodeIds.length) : (layer.chainNodeIds.length === 0);
            if (!chainDone) return false;

            // 检查子树是否全部完成
            var subCompleted = SMTool._isPlaybackTreeCompleted(layer.subLayerTree, subState);
            if (!subCompleted) return false;
        } else {
            // 无嵌套子树：检查链是否播完
            var chainDone2 = ls ? (ls.chainIdx >= layer.chainNodeIds.length) : (layer.chainNodeIds.length === 0);
            if (!chainDone2) return false;
        }
    }
    return true;
};

/**
 * 在 nodeStates 中初始化一棵播放树的状态（所有 layer 从 0 开始）
 * @returns {Object} 初始化的 nodeStates
 */
SMTool._initPlaybackTreeState = function (tree, existingStates) {
    var states = existingStates || {};
    if (!tree || !tree.layers) return states;

    for (var li = 0; li < tree.layers.length; li++) {
        var layer = tree.layers[li];
        var stateKey = 'L' + layer.layerNum;
        states[stateKey] = {
            chainIdx: 0,
            chainDone: false,
            delayElapsed: 0,
            loopTrack: { currentLoop: 0, totalElapsed: 0 },
            _subActive: false,  // 是否正在渲染嵌套子树（而非主链）
            _lastRptChainIdx: 0,
            _lastRptChainDone: false
        };

        // 递归初始化嵌套子树状态
        if (layer.subLayerNodeId && layer.subLayerTree) {
            var subStateKey = stateKey + '_subState';
            states[subStateKey] = SMTool._initPlaybackTreeState(layer.subLayerTree, null);
        }
    }
    return states;
};

/** 为层级节点设置浮窗预览 — 统一加载所有连线节点到预览 GL */
SMTool._showLayerPreview = function (layerNode, playbackOwner) {
    var pp = SMData._animPreview;
    var ld = SMTool._layerData(layerNode);
    var panel = document.getElementById('animPreviewPanel');
    var canvas = document.getElementById('appCanvas');
    if (!panel || !canvas) return;
    if (typeof SMTool._syncLayerListPreviewMode === 'function') SMTool._syncLayerListPreviewMode(true, false);

    // ★ 直接从连线表收集（三重兜底）
    var linkedNodes = [];
    for (var ci = 0; ci < SMData.connections.length; ci++) {
        var c = SMData.connections[ci];
        if (c.fromNode !== layerNode.id) continue;
        var ln = (c._layerNum >= 1 && c._layerNum <= ld.layerCount) ? c._layerNum : 0;
        if (!ln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
            ln = parseInt(c.fromState.replace('layer_', '')) || 0;
        }
        if (ln >= 1 && ln <= ld.layerCount) {
            var tn = SMData.nodes.get(c.toNode);
            // ★ 接受 Spine 动画节点、延时器节点、隐藏器节点 或 嵌套并行播放节点
            if (tn && (tn.nodeType === 'spine' || tn.nodeType === 'delayer' || tn.nodeType === 'progDelayer' || tn.nodeType === 'hider' || tn.nodeType === 'layer')) {
                var hasRes = (tn.nodeType === 'delayer' || tn.nodeType === 'progDelayer' || tn.nodeType === 'hider' || tn.nodeType === 'layer') || (tn._srcAtlasText && (tn._srcSkelJson || tn._srcSkelBinBase64) && (tn.textureImg || (tn._texImgs && tn._texImgs.length > 0)));
                if (hasRes) {
                    var dup = false;
                    for (var dj = 0; dj < linkedNodes.length; dj++) {
                        if (linkedNodes[dj].layer === ln) { dup = true; break; }
                    }
                    if (!dup) linkedNodes.push({ layer: ln, node: tn });
                }
            }
        }
    }
    // 同时检查 _layerData（兼容旧数据）
    for (var li = 1; li <= ld.layerCount; li++) {
        var info = ld.layers[li];
        if (info && info.animNodeId) {
            var dup2 = false;
            for (var dj2 = 0; dj2 < linkedNodes.length; dj2++) {
                if (linkedNodes[dj2].layer === li) { dup2 = true; break; }
            }
            if (!dup2) {
                var ln2 = SMData.nodes.get(info.animNodeId);
                if (ln2 && (ln2.nodeType === 'spine' || ln2.nodeType === 'delayer' || ln2.nodeType === 'progDelayer' || ln2.nodeType === 'hider' || ln2.nodeType === 'layer')) {
                    var hasRes2 = (ln2.nodeType === 'delayer' || ln2.nodeType === 'progDelayer' || ln2.nodeType === 'hider' || ln2.nodeType === 'layer') || (ln2._srcAtlasText && (ln2._srcSkelJson || ln2._srcSkelBinBase64) && (ln2.textureImg || (ln2._texImgs && ln2._texImgs.length > 0)));
                    if (hasRes2) {
                        linkedNodes.push({ layer: li, node: ln2 });
                    }
                }
            }
        }
    }

    if (linkedNodes.length === 0) {
        // 无连线节点 → 隐藏浮窗
        SMTool._destroyAnimPreview();
        panel.style.display = 'none';
        pp.visible = false;
        pp.nodeId = layerNode.id;
        pp._layerSkeletons = null;
        var title0 = document.getElementById('appTitle');
        if (title0) title0.textContent = '⚠ 层级节点未连线';
        var src0 = document.getElementById('appSourceFile');
        if (src0) src0.textContent = '';
        return;
    }

    // 先建立递归执行结构。它不仅用于播放，也用于从直接嵌套的 layer 中解析运行时版本。
    var initialPlaybackTree = SMTool._buildPlaybackTree(layerNode, 0);

    // 销毁旧预览
    // ★ 保存当前层的位置修改模式状态（barrier 重新初始化后恢复）
    var savedPosMode = pp._layerPosMode ? { active: pp._layerPosMode.active, selectedIndices: pp._layerPosMode.selectedIndices ? new Set(pp._layerPosMode.selectedIndices) : new Set(), _preEditOffsets: pp._layerPosMode._preEditOffsets ? JSON.parse(JSON.stringify(pp._layerPosMode._preEditOffsets)) : {} } : null;
    SMTool._destroyAnimPreview();
    panel.style.display = 'flex';
    pp.visible = true;
    pp.nodeId = layerNode.id;
    var activeFlow = SMData._fullPlayback;
    var activePath = activeFlow && activeFlow.activePathIdx >= 0 ? SMData._fullPaths[activeFlow.activePathIdx] : null;
    var activeFlowStep = activePath && activePath.nodes ? activePath.nodes[activeFlow.currentStep] : null;
    if (playbackOwner && playbackOwner.type) {
        pp._playbackOwner = playbackOwner;
    } else if (activeFlowStep && activeFlowStep.id === layerNode.id && (activeFlow.isPlaying || activeFlow._isPaused)) {
        pp._playbackOwner = { type: 'flow', pathIdx: activeFlow.activePathIdx, nodeId: layerNode.id };
    } else {
        pp._playbackOwner = { type: 'parallel', nodeId: layerNode.id, manualSelection: true };
        pp._flowFrozen = false;
        if (SMTool._setPreviewPauseUI) SMTool._setPreviewPauseUI(false);
    }
    // ★ 重置"所有分支已完成"标记（新预览周期）
    pp._allLayersCompletedOnce = false;
    pp._parallelCycleId = (pp._parallelCycleId || 0) + 1;
    pp._parallelBarrierCommitted = false;
    pp._parallelRestarting = false;

    // 确定 Spine 版本 — 优先从直连 Spine 节点获取，全是延时器时沿链查找
    var firstNode = null;
    for (var fni = 0; fni < linkedNodes.length; fni++) {
        if (linkedNodes[fni].node.nodeType === 'spine') { firstNode = linkedNodes[fni].node; break; }
    }
    // ★ 全延时器/隐藏器兜底：沿链找到第一个 Spine 动画节点
    if (!firstNode) {
        for (var fni2 = 0; fni2 < linkedNodes.length; fni2++) {
            var lnk = linkedNodes[fni2];
            if (lnk.node.nodeType === 'delayer' || lnk.node.nodeType === 'progDelayer' || lnk.node.nodeType === 'hider') {
                var chainIds = SMTool._buildChainFromNode(lnk.node.id);
                for (var ci = 0; ci < chainIds.length; ci++) {
                    var cn = SMData.nodes.get(chainIds[ci]);
                    if (cn && cn.nodeType === 'spine') { firstNode = cn; break; }
                }
                if (firstNode) break;
            }
        }
    }
    if (!firstNode) firstNode = SMTool._findFirstSpineInPlaybackTree(initialPlaybackTree);
    if (!firstNode) {
        // 真的没有任何 Spine 节点 → 隐藏面板
        panel.style.display = 'none';
        pp.visible = false;
        return;
    }
    var ver = firstNode.version || firstNode._spineVer || '';
    var useVer = SMTool._resolveRuntimeVersion(ver, null, false);
    var SP = SMTool._getSpineRuntime(useVer);

    // 设置画布 — 取 canvas 容器实际尺寸（排除标题栏），与单节点预览一致
    var savedW = pp.panelW || 385;
    var savedH = pp.panelH || 645;
    panel.style.width = savedW + 'px';
    panel.style.height = savedH + 'px';
    var wrap = canvas.parentElement;
    var cw = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : savedW;
    var ch = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : savedH;
    if (cw < 10) cw = savedW;
    if (ch < 10) ch = savedH;
    // ★ 仅在尺寸变化时才设置 canvas.width/height，避免触发 WebGL 缓冲区清空
    if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
    }
    pp.canvas = canvas;
    pp.panelW = savedW;
    pp.panelH = savedH;
    pp._canvasWidth = cw;
    pp._canvasHeight = ch;

    // 获取 GL 上下文
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });

    if (!SP || !gl) {
        // 加载失败 → 清屏并隐藏
        if (gl) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
        panel.style.display = 'none';
        pp.visible = false;
        return;
    }

    pp._spineVer = useVer;
    pp.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;
    var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;

    // ★ 统一加载所有层（含动画链）— 遇到嵌套并行播放节点时，链在此停止并标记子树
    // ★★ 先构建播放树（检测嵌套 layer 节点）
    pp._playbackTree = initialPlaybackTree;
    pp._layerPlaybackState = {
        activeTreeNodeId: layerNode.id,
        treeCompleted: false,
        nodeStates: pp._playbackTree ? SMTool._initPlaybackTreeState(pp._playbackTree, null) : {},
        parentStack: []
    };

    var layerSkeletons = [];
    for (var lj = 0; lj < linkedNodes.length; lj++) {
        var item = linkedNodes[lj];
        // ★ 构建从直接连线节点出发的动画链（遇到嵌套 layer 节点时停止）
        var chainIds = [];
        var playbackLayerInfo = null;
        if (pp._playbackTree) {
            // ★ 从播放树获取该层的 chainNodeIds
            for (var tli = 0; tli < pp._playbackTree.layers.length; tli++) {
                if (pp._playbackTree.layers[tli].layerNum === item.layer) {
                    playbackLayerInfo = pp._playbackTree.layers[tli];
                    chainIds = pp._playbackTree.layers[tli].chainNodeIds.slice();
                    break;
                }
            }
        }
        if (!playbackLayerInfo) {
            // 兜底：使用旧逻辑
            chainIds = SMTool._buildChainFromNode(item.node.id);
        }
        var chainSkeletons = [];
        for (var cni = 0; cni < chainIds.length; cni++) {
            var chainNode = SMData.nodes.get(chainIds[cni]);
            // ★ Spine 动画节点：加载完整骨架
            if (chainNode && chainNode.nodeType === 'spine' && chainNode._srcAtlasText && (chainNode._srcSkelJson || chainNode._srcSkelBinBase64) && (chainNode.textureImg || (chainNode._texImgs && chainNode._texImgs.length > 0))) {
                var cls = SMTool._loadOneSkeletonToGL(gl, SP, WGL, chainNode, physParam, cw, ch, useVer);
                if (cls) {
                    cls._chainNodeId = chainIds[cni];
                    cls._chainAnimName = chainNode.currentAnim || '';
                    chainSkeletons.push(cls);
                } else {
                    // ★ 加载失败诊断：记录失败原因便于排查
                    console.warn('[LayerPreview] 骨架加载失败: 节点#' + chainIds[cni] +
                        ' 源文件=' + (chainNode.sourceFile || '?') +
                        ' atlas=' + (chainNode._srcAtlasText ? '有' : '无') +
                        ' skel=' + (chainNode._srcSkelJson ? 'json' : (chainNode._srcSkelBinBase64 ? 'bin' : '无')) +
                        ' texImgs=' + (chainNode._texImgs ? chainNode._texImgs.length : 0) +
                        ' texImg=' + (chainNode.textureImg ? '有' : '无') +
                        ' skin=' + (chainNode.currentSkin || '默认'));
                }
            }
            // ★ 延时器节点：创建虚拟条目（无骨架，仅含延迟信息）
            else if (chainNode && (chainNode.nodeType === 'delayer' || chainNode.nodeType === 'progDelayer')) {
                chainSkeletons.push({
                    _chainNodeId: chainIds[cni],
                    _isDelayer: true,
                    _delayValue: chainNode._delayValue || 1.0,
                    _chainAnimName: '',
                    skeleton: null,
                    state: null,
                    shader: null,
                    batcher: null,
                    skeletonRenderer: null,
                    physParam: null,
                    mvp: null,
                    premultipliedAlpha: false,
                    aspectInfo: null
                });
            }
            // ★★ 隐藏器节点：创建虚拟条目（无骨架，仅含隐藏值 + 方向）
            else if (chainNode && chainNode.nodeType === 'hider') {
                chainSkeletons.push({
                    _chainNodeId: chainIds[cni],
                    _isHider: true,
                    _hideValue: (chainNode._hideValue !== undefined) ? chainNode._hideValue : -1,
                    _hideDirection: chainNode._hideDirection || 'left',
                    _chainAnimName: '',
                    skeleton: null,
                    state: null,
                    shader: null,
                    batcher: null,
                    skeletonRenderer: null,
                    physParam: null,
                    mvp: null,
                    premultipliedAlpha: false,
                    aspectInfo: null
                });
            }
        }
        // ★★ 链上无真实骨架但该层有嵌套子并行节点：创建虚拟占位条目
        if (chainSkeletons.length === 0 && pp._playbackTree) {
            var _hasSubLayer = false, _subLayerId = null, _subTree = null;
            for (var tli0 = 0; tli0 < pp._playbackTree.layers.length; tli0++) {
                if (pp._playbackTree.layers[tli0].layerNum === item.layer) {
                    if (pp._playbackTree.layers[tli0].subLayerNodeId) {
                        _hasSubLayer = true;
                        _subLayerId = pp._playbackTree.layers[tli0].subLayerNodeId;
                        _subTree = pp._playbackTree.layers[tli0].subLayerTree;
                    }
                    break;
                }
            }
            if (_hasSubLayer) {
                chainSkeletons.push({
                    _chainNodeId: item.node.id,
                    _isVirtualLayer: true,
                    _chainAnimName: '',
                    skeleton: null, state: null, shader: null, batcher: null,
                    skeletonRenderer: null, physParam: null, mvp: null,
                    premultipliedAlpha: false, aspectInfo: null
                });
                chainIds = [item.node.id];
            }
        }
        if (chainSkeletons.length > 0) {
            // 使用链首骨架作为主渲染骨架
            var firstSk = chainSkeletons[0];
            firstSk.layer = item.layer;
            firstSk.nodeId = item.node.id;
            // ★ 存储动画链数据
            firstSk._chainNodeIds = chainIds;
            firstSk._chainSkeletons = chainSkeletons;
            firstSk._chainIdx = 0;
            firstSk._chainDone = false;
            firstSk._chainElapsed = 0;
            firstSk._runtimePath = 'root:' + layerNode.id + '/L' + item.layer;
            // ★ 流面板分支高亮刷新追踪
            firstSk._lastRptChainIdx = 0;
            firstSk._lastRptChainDone = false;
            // ★ 循环追踪：记录当前循环次数和已流逝时间（动画流/并行播放循环控制）
            firstSk._loopTrack = { currentLoop: 0, totalElapsed: 0 };
            // ★★ 嵌套并行播放：若链末尾是嵌套的 layer 节点，在此记录引用
            if (pp._playbackTree) {
                for (var tli2 = 0; tli2 < pp._playbackTree.layers.length; tli2++) {
                    if (pp._playbackTree.layers[tli2].layerNum === item.layer) {
                        if (pp._playbackTree.layers[tli2].subLayerNodeId) {
                            firstSk._nestedLayerNodeId = pp._playbackTree.layers[tli2].subLayerNodeId;
                            firstSk._nestedSubTree = pp._playbackTree.layers[tli2].subLayerTree;
                        }
                        break;
                    }
                }
            }
            // ★ 若链首是延时器或隐藏器，从链上第一个 Spine 节点预取渲染器属性
            if (firstSk._isDelayer || firstSk._isHider) {
                firstSk._delayElapsed = 0;
                for (var csi2 = 0; csi2 < chainSkeletons.length; csi2++) {
                    var pre = chainSkeletons[csi2];
                    if (pre && !pre._isDelayer && !pre._isHider && pre.skeleton) {
                        firstSk.skeleton = pre.skeleton;
                        firstSk.state = pre.state;
                        firstSk.shader = pre.shader;
                        firstSk.batcher = pre.batcher;
                        firstSk.skeletonRenderer = pre.skeletonRenderer;
                        firstSk.sceneRenderer = pre.sceneRenderer;
                        firstSk.managedContext = pre.managedContext;
                        firstSk.useVer = pre.useVer;
                        firstSk.physParam = pre.physParam;
                        firstSk.mvp = pre.mvp;
                        firstSk.premultipliedAlpha = pre.premultipliedAlpha || false;
                        firstSk.aspectInfo = pre.aspectInfo;
                        break;
                    }
                }
            }
            // ★ 根据源节点的循环模式设置链骨架的 loop 属性
            for (var cli = 0; cli < chainSkeletons.length; cli++) {
                if (chainSkeletons[cli].state) {
                    try {
                        var ce = chainSkeletons[cli].state.getCurrent(0);
                        if (ce) {
                            var srcNode2 = SMData.nodes.get(chainSkeletons[cli]._chainNodeId);
                            // 源节点启用了循环且设置了循环模式 → 链骨架也循环
                            // ★ 循环判断：显式设置了循环模式 或 循环次数≠默认1（含-1无限循环）
                            var hasLoopCfg = srcNode2 && srcNode2.loop !== false && !!(srcNode2._loopMode || (srcNode2._loopCount !== undefined && srcNode2._loopCount !== 1));
                            if (hasLoopCfg) {
                                ce.loop = true;
                            } else {
                                ce.loop = false;
                            }
                        }
                    } catch (e) {}
                }
            }
            layerSkeletons.push(firstSk);
        }
    }

    if (layerSkeletons.length === 0) {
        // 全都加载失败 → 清屏并隐藏
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        panel.style.display = 'none';
        pp.visible = false; pp.gl = null;
        return;
    }

    // ★ 按层号排序，保证渲染顺序 = 层级顺序
    layerSkeletons.sort(function (a, b) { return (a.layer || 0) - (b.layer || 0); });
    var savedZoom = SMData._previewZooms && SMData._previewZooms['_layer_' + layerNode.id];
    if (!savedZoom || savedZoom <= 0.1 || savedZoom >= 10) {
        savedZoom = 1.0;
        for (var lk = 0; lk < layerSkeletons.length; lk++) {
            var ai = layerSkeletons[lk].aspectInfo;
            if (ai) {
                var layerFit = Math.min(cw / (ai.skelW || 1), ch / (ai.skelH || 1));
                if (layerFit < savedZoom) savedZoom = layerFit;
            }
        }
    }
    pp._contentZoom = savedZoom;
    // ★ 用统一 zoom 覆写所有层（含链上所有骨架）的 MVP + 同时恢复已保存位置偏移
    // 重要：在同一个循环中一步到位算出最终位置，避免中间闪过默认居中位置
    for (var li2 = 0; li2 < layerSkeletons.length; li2++) {
        var lsi = layerSkeletons[li2];
        var savedData = (lsi.layer && layerNode._layerData && layerNode._layerData.layers[lsi.layer]) ? layerNode._layerData.layers[lsi.layer] : null;
        var chainPositions = savedData && savedData._chainPositions;

        if (lsi._chainSkeletons) {
            for (var csi = 0; csi < lsi._chainSkeletons.length; csi++) {
                var csk = lsi._chainSkeletons[csi];
                // 先更新 MVP（居中和 ortho 分开处理，位置由我们精确控制）
                if (csk.mvp) {
                    csk.mvp.ortho2d(cw / 2 - cw / (2 * savedZoom), ch / 2 - ch / (2 * savedZoom), cw / savedZoom, ch / savedZoom);
                }
                if (csk.sceneRenderer) {
                    csk.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                    csk.sceneRenderer.camera.viewportWidth = cw / savedZoom;
                    csk.sceneRenderer.camera.viewportHeight = ch / savedZoom;
                    csk.sceneRenderer.camera.update();
                }
                if (csk.skeleton && csk.aspectInfo) {
                    // ★ 计算默认居中位置
                    var defX = cw / 2 - csk.aspectInfo.centerX;
                    var defY = ch / 2 - csk.aspectInfo.centerY;
                    csk._defaultSkX = defX;
                    csk._defaultSkY = defY;
                    // ★★ 容器模型：最终位置 = 默认居中 + 容器偏移 + 个体微调偏移
                    // 若有 _containerOffset 则以其为准，忽略旧 _chainPositions 防止双重叠加
                    var containerOff = (savedData && savedData._containerOffset) ? savedData._containerOffset : { offX: 0, offY: 0 };
                    var hasCO = savedData && savedData._containerOffset;
                    var cp = (!hasCO && chainPositions && csk._chainNodeId != null) ? chainPositions[csk._chainNodeId] : null;
                    csk.skeleton.x = defX + containerOff.offX + (cp ? (cp.offX || 0) : 0);
                    csk.skeleton.y = defY + containerOff.offY + (cp ? (cp.offY || 0) : 0);
                }
            }
        } else if (lsi.mvp && lsi.aspectInfo) {
            lsi.mvp.ortho2d(cw / 2 - cw / (2 * savedZoom), ch / 2 - ch / (2 * savedZoom), cw / savedZoom, ch / savedZoom);
            if (lsi.skeleton) {
                var defX2 = cw / 2 - lsi.aspectInfo.centerX;
                var defY2 = ch / 2 - lsi.aspectInfo.centerY;
                lsi._defaultSkX = defX2;
                lsi._defaultSkY = defY2;
                // ★★ 兼容旧格式：容器偏移 + 单骨架位置偏移
                var containerOff2 = (savedData && savedData._containerOffset) ? savedData._containerOffset : { offX: 0, offY: 0 };
                var offX2 = (savedData && savedData.posOffX) ? savedData.posOffX : 0;
                var offY2 = (savedData && savedData.posOffY) ? savedData.posOffY : 0;
                lsi.skeleton.x = defX2 + containerOff2.offX + offX2;
                lsi.skeleton.y = defY2 + containerOff2.offY + offY2;
            }
        }
    }
    SMTool._updateAnimPreviewZoomLabel(savedZoom);

    // ★★ 容器模型：存储每层的容器偏移到 ls 条目上（供嵌套子树渲染继承）
    for (var li3 = 0; li3 < layerSkeletons.length; li3++) {
        var lsi3 = layerSkeletons[li3];
        var sd3 = (lsi3.layer && layerNode._layerData && layerNode._layerData.layers[lsi3.layer]) ? layerNode._layerData.layers[lsi3.layer] : null;
        var co3 = (sd3 && sd3._containerOffset) ? sd3._containerOffset : { offX: 0, offY: 0 };
        lsi3._containerOffX = co3.offX || 0;
        lsi3._containerOffY = co3.offY || 0;
    }

    pp._layerSkeletons = layerSkeletons;
    pp._lastLayerThumbTime = 0;
    // ★ 恢复之前激活的位置修改模式（barrier 重新初始化后保持激活状态）
    if (savedPosMode && savedPosMode.active && savedPosMode.selectedIndices && savedPosMode.selectedIndices.size > 0) {
        pp._layerPosMode = savedPosMode;
        // ★ 重新保存各层骨架位置快照（barrier 重建后骨架对象已更新）
        for (var sdi = 0; sdi < layerSkeletons.length; sdi++) {
            layerSkeletons[sdi]._preEditSkelPositions = [];
            var _collectSkels2 = function (entry) {
                if (!entry) return;
                var chain = entry._chainSkeletons;
                if (chain && chain.length > 0) {
                    for (var cj = 0; cj < chain.length; cj++) {
                        if (chain[cj].skeleton) layerSkeletons[sdi]._preEditSkelPositions.push({ sk: chain[cj].skeleton, x: chain[cj].skeleton.x, y: chain[cj].skeleton.y });
                    }
                } else if (entry.skeleton) {
                    layerSkeletons[sdi]._preEditSkelPositions.push({ sk: entry.skeleton, x: entry.skeleton.x, y: entry.skeleton.y });
                }
            };
            _collectSkels2(layerSkeletons[sdi]);
        }
    }
    pp.skeleton = null;
    pp.state = null;
    pp._readyToRender = true;
    pp._lastTime = performance.now();
    pp.visible = true;

    var title = document.getElementById('appTitle');
    if (title) title.textContent = '📚 层级 (' + layerSkeletons.length + '/' + ld.layerCount + '层就绪)';
    var srcEl = document.getElementById('appSourceFile');
    if (srcEl) {
        var srcNames = [];
        for (var lni = 0; lni < linkedNodes.length; lni++) {
            var lnk = linkedNodes[lni];
            if (lnk.node && lnk.node.sourceFile && srcNames.indexOf(lnk.node.sourceFile) < 0) {
                srcNames.push(lnk.node.sourceFile);
            }
        }
        srcEl.textContent = srcNames.length > 0 ? srcNames.join('、') : '';
    }

    // ★ 诊断：若全部加载失败，标题显示错误
    if (layerSkeletons.length === 0 && linkedNodes.length > 0) {
        if (title) title.textContent = '⚠ 层级加载失败(贴图/版本?)';
        if (srcEl) srcEl.textContent = '';
    }

    // ★ 立即同步初次活跃节点集合到主画布，消除第 1 帧延迟
    if (pp._layerSkeletons && pp._layerSkeletons.length > 0) {
        var initActiveIds = new Set();
        var initAllIds = new Set();
        for (var si = 0; si < pp._layerSkeletons.length; si++) {
            var lsk = pp._layerSkeletons[si];
            var chains = lsk._chainSkeletons || [lsk];
            var curIdx = lsk._chainIdx || 0;
            var curActive = (chains.length > curIdx) ? chains[curIdx] : chains[0];
            var nid = (curActive && curActive._chainNodeId) || lsk.nodeId;
            if (nid != null) initActiveIds.add(nid);
            for (var cj = 0; cj < chains.length; cj++) {
                var cnid = chains[cj]._chainNodeId;
                if (cnid != null) initAllIds.add(cnid);
            }
        }
        SMData._layerPlayingNodes = initActiveIds;
        SMData._layerAllChainNodes = initAllIds;
        // ★ 同步主画布 CSS 高亮/置灰效果
        SMTool._updateLayerPlayingHighlights(initActiveIds, initAllIds, {});

        // 原子提交共同第 0 帧。直接嵌套 layer 第一遍只激活子树，
        // 所以冻结状态下连续绘制两次，第二遍把子树第 0 帧一并合成。
        var initialNow = performance.now();
        var initialFrozen = !!pp._flowFrozen;
        pp._flowFrozen = true;
        SMTool._renderLayerPreview(null, pp, initialNow);
        SMTool._renderLayerPreview(null, pp, initialNow);
        pp._flowFrozen = initialFrozen;
        pp._lastTime = performance.now();
    }
    // 每次选择新的并行节点/流程步骤都按新的运行时层数据立即重建列表。
    if (typeof SMTool._syncLayerListPreviewMode === 'function') SMTool._syncLayerListPreviewMode(true, true);
};

/** 加载单个节点的骨架到指定的 GL 上下文，返回骨架渲染数据 */
SMTool._loadOneSkeletonToGL = function (gl, SP, WGL, srcNode, physParam, cw, ch, useVer) {
    // 每个动画资源按自身 Spine 版本解析；并行层允许组合不同版本的源文件。
    var sourceVersion = srcNode.version || srcNode._spineVer || useVer || '';
    var resolvedVersion = SMTool._resolveRuntimeVersion(sourceVersion, null, false);
    var resolvedRuntime = SMTool._getSpineRuntime(resolvedVersion);
    if (resolvedRuntime) {
        useVer = resolvedVersion;
        SP = resolvedRuntime;
        WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;
        physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;
    }
    if (!SP) return null;
    var atlasText = srcNode._srcAtlasText;
    var skelJson = srcNode._srcSkelJson;
    var skelBin = srcNode._srcSkelBinBase64;
    var srcType = srcNode._srcType || 'json';

    // 获取贴图
    var texDataUrls = (srcNode._srcTexDataUrls && srcNode._srcTexDataUrls.length > 0)
        ? srcNode._srcTexDataUrls
        : [{ name: 'texture', dataUrl: srcNode._srcTexDataUrl }];
    var imgs = [];
    for (var pi = 0; pi < texDataUrls.length; pi++) {
        var img = null;
        if (srcNode._texImgs && srcNode._texImgs[pi]) {
            img = srcNode._texImgs[pi];
        } else if (srcNode.textureImg && pi === 0) {
            img = srcNode.textureImg;
        }
        if (!img) return null;
        imgs[pi] = img;
    }

    // 解析 atlas
    var atlas;
    if (useVer === '4.3' || useVer === '4.2') {
        atlas = new SP.TextureAtlas(atlasText);
    } else {
        atlas = new SP.TextureAtlas(atlasText, function () { return new SP.FakeTexture(imgs[0]); });
    }

    // 解析 skeleton（使用容错版 AttachmentLoader + atlas 补丁）
    SMTool._patchAtlasForLoading(atlas);
    var al = SMTool._createLenientAttachmentLoader(atlas, SP);
    var sd;
    if (srcType === 'skel' && skelBin) {
        var bl = new SP.SkeletonBinary(al); bl.scale = 1;
        sd = bl.readSkeletonData(SMTool._base64ToUint8(skelBin));
    } else if (skelJson) {
        var jl = new SP.SkeletonJson(al); jl.scale = 1;
        sd = jl.readSkeletonData(skelJson);
    } else {
        return null;
    }

    var sk = new SP.Skeleton(sd);
    var skinName = srcNode.currentSkin;
    if (skinName) {
        for (var ski = 0; ski < sd.skins.length; ski++) {
            if (sd.skins[ski].name === skinName) { sk.setSkin(sd.skins[ski]); break; }
        }
    } else if (sd.defaultSkin) {
        sk.setSkin(sd.defaultSkin);
    }
    sk.setToSetupPose();
    sk.updateWorldTransform(physParam);

    // ★ 等比例适配：用与单节点预览相同的居中逻辑
    var bo = new SP.Vector2(), bs = new SP.Vector2();
    try { if (typeof sk.getBounds === 'function') sk.getBounds(bo, bs, []); } catch(e) {}
    // ★ 防御 null/NaN/0 bounds（部分骨架 setup pose 下无可见附件，getBounds 返回 null/NaN）
    var boundsValid = Number.isFinite(bs.x) && bs.x > 0 && Number.isFinite(bs.y) && bs.y > 0;
    var skelW = boundsValid ? bs.x : 400;
    var skelH = boundsValid ? bs.y : 400;
    // 无效 bounds 时 centerX/Y=0（骨架原点对齐画布中心），有效时用实际中心
    var centerX = boundsValid ? (Number.isFinite(bo.x) ? bo.x : 0) + skelW / 2 : 0;
    var centerY = boundsValid ? (Number.isFinite(bo.y) ? bo.y : 0) + skelH / 2 : 0;
    // 与单节点预览一致的居中
    sk.x = cw / 2 - centerX;
    sk.y = ch / 2 - centerY;
    // 保存边界信息，统一缩放由 _showLayerPreview / _syncLayerPreviewViewport 计算
    var aspectInfo = { centerX: centerX, centerY: centerY, skelW: skelW, skelH: skelH };

    // WebGL 纹理
    var glTextures = [];
    var managedContext = null;
    var sceneRenderer = null;
    if (useVer === '4.3' || useVer === '4.2') {
        // 同一预览画布、同一 Runtime 共享 ManagedContext，避免多个状态包装器互相覆盖。
        if (!SMTool._layerManagedContexts4x || SMTool._layerManagedContexts4x.canvas !== gl.canvas) {
            SMTool._layerManagedContexts4x = { canvas: gl.canvas, contexts: {} };
        }
        managedContext = SMTool._layerManagedContexts4x.contexts[useVer];
        if (!managedContext) {
            managedContext = new SP.ManagedWebGLRenderingContext(gl.canvas, { alpha: true });
            SMTool._layerManagedContexts4x.contexts[useVer] = managedContext;
        }
        sceneRenderer = new SP.SceneRenderer(gl.canvas, managedContext, true);
        sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
        sceneRenderer.camera.viewportWidth = cw;
        sceneRenderer.camera.viewportHeight = ch;
        sceneRenderer.camera.update();
        for (var ti = 0; ti < atlas.pages.length; ti++) {
            var pi2 = (imgs && ti < imgs.length) ? imgs[ti] : imgs[0];
            var glTex2 = new SP.GLTexture(managedContext, pi2, atlas.pages[ti].pma || false);
            atlas.pages[ti].setTexture(glTex2);
            glTextures.push(glTex2);
        }
    } else if (WGL && WGL.Shader) {
        for (var tj = 0; tj < atlas.pages.length; tj++) {
            var pi3 = (imgs && tj < imgs.length) ? imgs[tj] : imgs[0];
            var glTex3 = new WGL.GLTexture(gl, pi3, false);
            atlas.pages[tj].texture = glTex3;
            glTextures.push(glTex3);
        }
    }
    for (var rk = 0; rk < atlas.regions.length; rk++) {
        if (atlas.regions[rk].page && atlas.regions[rk].page.texture) {
            atlas.regions[rk].texture = atlas.regions[rk].page.texture;
        }
    }

    // AnimationState
    var stateData = new SP.AnimationStateData(sd);
    var state = new SP.AnimationState(stateData);
    var animName = srcNode.currentAnim || (srcNode.animations[0] && srcNode.animations[0].name) || '';
    if (!srcNode._trackMode && animName) {
        // 并行链中的普通动画节点默认只播放一次。只有显式配置了循环时间/次数时，
        // 才允许 AnimationState 自身回卷；否则完成判定前的一次回卷会造成“各层独立循环”的错觉。
        var hasExplicitLoop = srcNode.loop !== false &&
            !!(srcNode._loopMode || (srcNode._loopCount !== undefined && srcNode._loopCount !== 1));
        state.setAnimation(0, animName, hasExplicitLoop);
        state.update(0);
        state.apply(sk);
    }
    sk.updateWorldTransform(physParam);

    // 3.8 渲染器
    var shader = null, batcher = null, mvp = null, skRenderer = null;
    if ((useVer !== '4.3' && useVer !== '4.2') && WGL && WGL.Shader) {
        shader = WGL.Shader.newTwoColoredTextured(gl);
        batcher = new WGL.PolygonBatcher(gl);
        mvp = new WGL.Matrix4();
        // ★ 与单节点预览一致的 ortho（1 世界单位 = 1 像素）
        mvp.ortho2d(0, 0, cw - 1, ch - 1);
        skRenderer = new WGL.SkeletonRenderer(gl);
    }

    var loadedEntry = {
        skeleton: sk,
        skeletonData: sd,
        _skeletonData: sd,
        state: state,
        physParam: physParam,
        premultipliedAlpha: srcNode.premultipliedAlpha || false,
        useVer: useVer,
        shader: shader,
        batcher: batcher,
        mvp: mvp,
        skeletonRenderer: skRenderer,
        managedContext: managedContext,
        sceneRenderer: sceneRenderer,
        glTextures: glTextures,
        aspectInfo: aspectInfo,  // ★ 等比例参数
        _trackMode: !!srcNode._trackMode,
        _trackSequence: srcNode._trackSequence || [],
        _trackQueueRuntime: {},
        _trackMixSlotGuards: {},
        _trackElapsed: 0
    };
    if (loadedEntry._trackMode) {
        var trackHasExplicitLoop = srcNode.loop !== false &&
            !!(srcNode._loopMode || (srcNode._loopCount !== undefined && srcNode._loopCount !== 1));
        var layerBuildSequences = trackHasExplicitLoop ?
            loadedEntry._trackSequence : SMTool._finiteTrackSequences(loadedEntry._trackSequence);
        for (var tsi = 0; tsi < layerBuildSequences.length; tsi++) {
            SMTool._buildNativeTrackSequence(loadedEntry, state, layerBuildSequences, useVer, tsi, false);
        }
        state.update(0);
        state.apply(sk);
        sk.updateWorldTransform(physParam);
    }
    return loadedEntry;
};

// ================================================================
// 动画流并行分支
// ================================================================

/** 为层级节点展开并行流程路径 */
SMTool._expandLayerFlowPaths = function (layerNode) {
    var ld = SMTool._layerData(layerNode);
    var paths = [];
    for (var lnum = 1; lnum <= ld.layerCount; lnum++) {
        var layerInfo = ld.layers[lnum];
        if (layerInfo && layerInfo.animNodeId) {
            // 为每层计算一条独立路径
            var path = SMTool._findPathFromNode(layerInfo.animNodeId);
            if (path && path.length > 0) {
                paths.push({ layer: lnum, startNode: layerInfo.animNodeId, nodes: path });
            }
        }
    }
    return paths;
};

/** 从指定节点出发查找后续流程路径 */
SMTool._findPathFromNode = function (startNid) {
    var visited = new Set();
    var path = [];
    var current = startNid;

    while (current && !visited.has(current)) {
        visited.add(current);
        path.push(current);

        // 查找从此节点出发的连线
        var nextNid = null;
        for (var ci = 0; ci < SMData.connections.length; ci++) {
            var c = SMData.connections[ci];
            if (c.fromNode === current && !visited.has(c.toNode)) {
                nextNid = c.toNode;
                break;
            }
        }
        current = nextNid;
    }

    return path;
};

/** 获取层级节点播放时所有层需要的动画节点集合 */
SMTool._getLayerAnimNodes = function (layerNode) {
    var ld = SMTool._layerData(layerNode);
    var nodes = [];
    for (var lnum = 1; lnum <= ld.layerCount; lnum++) {
        var layerInfo = ld.layers[lnum];
        if (layerInfo && layerInfo.animNodeId) {
            var n = SMData.nodes.get(layerInfo.animNodeId);
            if (n && n.nodeType === 'spine') {
                nodes.push({ layer: lnum, node: n });
            }
        }
    }
    return nodes;
};

// ================================================================
// ★★ 嵌套子树管理（金字塔模型）
// ================================================================

/**
 * ★★ 为层骨架条目加载嵌套并行节点的子层骨架（缓存到 ls._nestedLayerSkeletons）
 * 此函数不修改 pp._layerSkeletons，不打断同层其他骨架的渲染。
 * @param parentContainerOff - { offX, offY } 可选，父层的容器偏移量（容器模型）
 * @param runtimePath - 运行实例路径；同一 layer 被多处分支引用时用于隔离播放状态
 */
SMTool._ensureSubtreeSkeletons = function (nestedLayerNodeId, pp, parentContainerOff, runtimePath) {
    var cache = pp._subtreeCache || {};
    var cacheKey = runtimePath || ('layer:' + nestedLayerNodeId);
    if (cache[cacheKey] && cache[cacheKey].skeletons) {
        return cache[cacheKey];
    }

    var nestedLayerNode = SMData.nodes.get(nestedLayerNodeId);
    if (!nestedLayerNode || nestedLayerNode.nodeType !== 'layer') return null;

    var ld = SMTool._layerData(nestedLayerNode);
    if (!ld) return null;

    var linkedNodes = [];
    for (var ci = 0; ci < SMData.connections.length; ci++) {
        var c = SMData.connections[ci];
        if (c.fromNode !== nestedLayerNodeId) continue;
        var ln = (c._layerNum >= 1 && c._layerNum <= ld.layerCount) ? c._layerNum : 0;
        if (!ln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
            ln = parseInt(c.fromState.replace('layer_', '')) || 0;
        }
        if (ln >= 1 && ln <= ld.layerCount) {
            var tn = SMData.nodes.get(c.toNode);
            if (tn && (tn.nodeType === 'spine' || tn.nodeType === 'delayer' || tn.nodeType === 'progDelayer' || tn.nodeType === 'hider' || tn.nodeType === 'layer')) {
                linkedNodes.push({ layer: ln, node: tn });
            }
        }
    }

    if (linkedNodes.length === 0) {
        cache[cacheKey] = { skeletons: [], gl: pp.gl, runtimePath: cacheKey };
        pp._subtreeCache = cache;
        return cache[cacheKey];
    }

    var gl = pp.gl;
    var useVer = pp._spineVer || '3.8';
    var SP = SMTool._getSpineRuntime(useVer);
    var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;
    var physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;
    var cw = pp._canvasWidth || 385;
    var ch = pp._canvasHeight || 645;

    var subTree = SMTool._buildPlaybackTree(nestedLayerNode, 0, new Set());

    var layerSkeletons = [];
    for (var lj = 0; lj < linkedNodes.length; lj++) {
        var item = linkedNodes[lj];
        var chainIds = [];
        var playbackLayerInfo = null;
        if (subTree) {
            for (var tli = 0; tli < subTree.layers.length; tli++) {
                if (subTree.layers[tli].layerNum === item.layer) {
                    playbackLayerInfo = subTree.layers[tli];
                    chainIds = subTree.layers[tli].chainNodeIds.slice();
                    break;
                }
            }
        }
        if (!playbackLayerInfo) {
            chainIds = SMTool._buildChainFromNode(item.node.id);
        }

        var chainSkeletons = [];
        for (var cni = 0; cni < chainIds.length; cni++) {
            var chainNode = SMData.nodes.get(chainIds[cni]);
            if (chainNode && chainNode.nodeType === 'spine' && chainNode._srcAtlasText && (chainNode._srcSkelJson || chainNode._srcSkelBinBase64) && (chainNode.textureImg || (chainNode._texImgs && chainNode._texImgs.length > 0))) {
                var cls = SMTool._loadOneSkeletonToGL(gl, SP, WGL, chainNode, physParam, cw, ch, useVer);
                if (cls) {
                    cls._chainNodeId = chainIds[cni];
                    cls._chainAnimName = chainNode.currentAnim || '';
                    chainSkeletons.push(cls);
                }
            } else if (chainNode && (chainNode.nodeType === 'delayer' || chainNode.nodeType === 'progDelayer')) {
                chainSkeletons.push({
                    _chainNodeId: chainIds[cni], _isDelayer: true,
                    _delayValue: chainNode._delayValue || 1.0, _chainAnimName: '',
                    skeleton: null, state: null, shader: null, batcher: null,
                    skeletonRenderer: null, physParam: null, mvp: null,
                    premultipliedAlpha: false, aspectInfo: null
                });
            }
            // ★★ 隐藏器节点
            else if (chainNode && chainNode.nodeType === 'hider') {
                chainSkeletons.push({
                    _chainNodeId: chainIds[cni], _isHider: true,
                    _hideValue: (chainNode._hideValue !== undefined) ? chainNode._hideValue : -1,
                    _hideDirection: chainNode._hideDirection || 'left',
                    _chainAnimName: '',
                    skeleton: null, state: null, shader: null, batcher: null,
                    skeletonRenderer: null, physParam: null, mvp: null,
                    premultipliedAlpha: false, aspectInfo: null
                });
            }
        }

        // layer → layer 直接连线没有普通链条目，创建只负责激活子树的运行占位。
        if (chainSkeletons.length === 0 && playbackLayerInfo && playbackLayerInfo.subLayerNodeId) {
            chainSkeletons.push({
                _chainNodeId: item.node.id,
                _isVirtualLayer: true,
                _chainAnimName: '',
                skeleton: null, state: null, shader: null, batcher: null,
                skeletonRenderer: null, physParam: null, mvp: null,
                premultipliedAlpha: false, aspectInfo: null
            });
            chainIds = [item.node.id];
        }

        if (chainSkeletons.length > 0) {
            var firstSk = chainSkeletons[0];
            firstSk.layer = item.layer;
            firstSk.nodeId = item.node.id;
            firstSk._chainNodeIds = chainIds;
            firstSk._chainSkeletons = chainSkeletons;
            firstSk._chainIdx = 0;
            firstSk._chainDone = false;
            firstSk._chainElapsed = 0;
            firstSk._runtimePath = cacheKey + '/L' + item.layer;
            firstSk._delayElapsed = 0;
            firstSk._lastRptChainIdx = 0;
            firstSk._lastRptChainDone = false;
            firstSk._loopTrack = { currentLoop: 0, totalElapsed: 0 };

            if (firstSk._isDelayer || firstSk._isHider) {
                for (var csi2 = 0; csi2 < chainSkeletons.length; csi2++) {
                    var pre = chainSkeletons[csi2];
                    if (pre && !pre._isDelayer && !pre._isHider && pre.skeleton) {
                        firstSk.skeleton = pre.skeleton; firstSk.state = pre.state;
                        firstSk.shader = pre.shader; firstSk.batcher = pre.batcher;
                        firstSk.skeletonRenderer = pre.skeletonRenderer;
                        firstSk.sceneRenderer = pre.sceneRenderer;
                        firstSk.managedContext = pre.managedContext;
                        firstSk.useVer = pre.useVer;
                        firstSk.physParam = pre.physParam; firstSk.mvp = pre.mvp;
                        firstSk.premultipliedAlpha = pre.premultipliedAlpha || false;
                        firstSk.aspectInfo = pre.aspectInfo;
                        break;
                    }
                }
            }

            // ★★ 一次性算好累加的容器偏移（祖先 + 当前层自身），应用到所有链骨架
            var pco = parentContainerOff || { offX: 0, offY: 0 };
            var nco = null;
            if (nestedLayerNode && nestedLayerNode._layerData && nestedLayerNode._layerData.layers[item.layer]) {
                nco = nestedLayerNode._layerData.layers[item.layer]._containerOffset;
            }
            var accOffX = pco.offX + (nco ? (nco.offX || 0) : 0);
            var accOffY = pco.offY + (nco ? (nco.offY || 0) : 0);
            // ★★ 遍历所有链骨架，逐个应用容器偏移（不只是链首！）
            for (var csiPos = 0; csiPos < chainSkeletons.length; csiPos++) {
                var cskPos = chainSkeletons[csiPos];
                if (cskPos.mvp) {
                    cskPos.mvp.ortho2d(cw / 2 - cw / (2 * (pp._contentZoom || 1)), ch / 2 - ch / (2 * (pp._contentZoom || 1)), cw / (pp._contentZoom || 1), ch / (pp._contentZoom || 1));
                }
                if (cskPos.sceneRenderer) {
                    var subtreeZoom = pp._contentZoom || 1;
                    cskPos.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                    cskPos.sceneRenderer.camera.viewportWidth = cw / subtreeZoom;
                    cskPos.sceneRenderer.camera.viewportHeight = ch / subtreeZoom;
                    cskPos.sceneRenderer.camera.update();
                }
                if (cskPos.skeleton && cskPos.aspectInfo) {
                    cskPos._defaultSkX = cw / 2 - cskPos.aspectInfo.centerX;
                    cskPos._defaultSkY = ch / 2 - cskPos.aspectInfo.centerY;
                    // 该链骨架的个体微调偏移
                    var _indOff = null;
                    if (nestedLayerNode && nestedLayerNode._layerData && nestedLayerNode._layerData.layers[item.layer]) {
                        var _lp = nestedLayerNode._layerData.layers[item.layer]._chainPositions;
                        if (_lp && cskPos._chainNodeId != null && _lp[cskPos._chainNodeId]) {
                            _indOff = _lp[cskPos._chainNodeId];
                        }
                    }
                    cskPos.skeleton.x = cskPos._defaultSkX + accOffX + (_indOff ? (_indOff.offX || 0) : 0);
                    cskPos.skeleton.y = cskPos._defaultSkY + accOffY + (_indOff ? (_indOff.offY || 0) : 0);
                }
            }
            // ★★ 存储累加偏移到链首 firstSk，供更深层嵌套子树继承
            firstSk._containerOffX = accOffX;
            firstSk._containerOffY = accOffY;

            // ★ 标记嵌套子树引用（递归）
            if (subTree) {
                for (var tli2 = 0; tli2 < subTree.layers.length; tli2++) {
                    if (subTree.layers[tli2].layerNum === item.layer) {
                        if (subTree.layers[tli2].subLayerNodeId) {
                            firstSk._nestedLayerNodeId = subTree.layers[tli2].subLayerNodeId;
                            firstSk._nestedSubTree = subTree.layers[tli2].subLayerTree;
                        }
                        break;
                    }
                }
            }

            layerSkeletons.push(firstSk);
        }
    }

    layerSkeletons.sort(function (a, b) { return (a.layer || 0) - (b.layer || 0); });

    cache[cacheKey] = {
        skeletons: layerSkeletons,
        gl: gl,
        subTree: subTree,
        nodeStates: subTree ? SMTool._initPlaybackTreeState(subTree, null) : {},
        runtimePath: cacheKey
    };
    pp._subtreeCache = cache;

    return cache[cacheKey];
};

// ================================================================
// ★★ 单层链推进辅助函数（提取公共逻辑，供主层和嵌套子层复用）
// ================================================================

// 将一个真实 Spine 链条目重置到第 0 帧；轨道模式会重建全部原生队列。
SMTool._resetLayerAnimationEntry = function (entry) {
    if (!entry || !entry.state || !entry.skeleton) return;
    var srcNode = entry._chainNodeId != null ? SMData.nodes.get(entry._chainNodeId) : null;
    try { entry.state.clearTracks(); } catch (e) {}
    entry._trackElapsed = 0;
    entry._trackQueueRuntime = {};
    entry.skeleton.setToSetupPose();
    if (entry._trackMode && entry._trackSequence) {
        var trackHasExplicitLoop = srcNode && srcNode.loop !== false &&
            !!(srcNode._loopMode || (srcNode._loopCount !== undefined && srcNode._loopCount !== 1));
        var resetSequences = trackHasExplicitLoop ?
            entry._trackSequence : SMTool._finiteTrackSequences(entry._trackSequence);
        for (var ti = 0; ti < resetSequences.length; ti++) {
            SMTool._buildNativeTrackSequence(entry, entry.state, resetSequences, entry.useVer, ti, false);
        }
    } else {
        var animName = entry._chainAnimName || (srcNode && srcNode.currentAnim) || '';
        if (animName) {
            var hasLoopCfg = srcNode && srcNode.loop !== false && !!(srcNode._loopMode || (srcNode._loopCount !== undefined && srcNode._loopCount !== 1));
            entry.state.setAnimation(0, animName, !!hasLoopCfg);
        }
    }
    entry.state.update(0);
    entry.state.apply(entry.skeleton);
    entry.skeleton.updateWorldTransform(entry.physParam);
};

// 在并行层的 A→B 切换处复用 Spine AnimationState 原生 mixingFrom。
// 普通↔普通、普通↔轨道、轨道↔轨道统一走同一过渡器。
SMTool._prepareLayerConnectionMix = function (fromEntry, toEntry) {
    if (!fromEntry || !toEntry || !fromEntry.state || !toEntry.state || !toEntry.skeleton) return false;
    var fromNode = fromEntry._chainNodeId != null ? SMData.nodes.get(fromEntry._chainNodeId) : null;
    var toNode = toEntry._chainNodeId != null ? SMData.nodes.get(toEntry._chainNodeId) : null;
    if (!fromNode || !toNode) return false;
    var duration = typeof SMTool._getConnectionMixDuration === 'function' ?
        SMTool._getConnectionMixDuration(fromNode.id, toNode.id) : 0;
    if (!(duration > 0)) return false;
    var sameSource = fromNode.sourceFile && fromNode.sourceFile === toNode.sourceFile;
    if (!sameSource && fromNode._srcAtlasText && fromNode._srcAtlasText === toNode._srcAtlasText) sameSource = true;
    if (!sameSource) return false;

    var skeletonData = toEntry._skeletonData || toEntry.skeletonData;
    if (!skeletonData || typeof SMTool._primeStateWithNodeFinalPose !== 'function' ||
        typeof SMTool._transitionStateToNode !== 'function') return false;

    var mixFromNode = fromNode;
    var mixToNode = toNode;
    if (!fromNode._trackMode && fromEntry._chainAnimName && fromEntry._chainAnimName !== fromNode.currentAnim) {
        mixFromNode = Object.create(fromNode);
        mixFromNode.currentAnim = fromEntry._chainAnimName;
    }
    if (!toNode._trackMode && toEntry._chainAnimName && toEntry._chainAnimName !== toNode.currentAnim) {
        mixToNode = Object.create(toNode);
        mixToNode.currentAnim = toEntry._chainAnimName;
    }

    try {
        if (!SMTool._primeStateWithNodeFinalPose(toEntry.state, toEntry.skeleton, skeletonData, mixFromNode, toEntry.useVer)) return false;
        if (!SMTool._transitionStateToNode(toEntry, toEntry.state, toEntry.skeleton, skeletonData, mixToNode, toEntry.useVer, duration)) return false;
        toEntry.skeleton.updateWorldTransform(toEntry.physParam);
        toEntry._trackElapsed = 0;
        toEntry._connectionMixDuration = duration;
        return true;
    } catch (e) {
        return false;
    }
};

// 有限次数的轨道序列到达最后一轮时，将画面钉在整条序列的真实末帧。
// 否则原生循环队列会在边界先进入下一轮首帧，再被外层屏障冻结。
SMTool._freezeLayerTrackSequenceAtFinalFrame = function (entry) {
    if (!entry || !entry.state || !entry.skeleton || !entry._trackSequence) return;
    var elapsed = entry._trackElapsed || 0;
    try {
        entry.state.clearTracks();
        entry.skeleton.setToSetupPose();
        entry._trackQueueRuntime = {};
        var finiteSequences = SMTool._finiteTrackSequences(entry._trackSequence);
        for (var ti = 0; ti < finiteSequences.length; ti++) {
            SMTool._buildNativeTrackSequence(entry, entry.state, finiteSequences, entry.useVer, ti, false);
        }
        entry.state.update(Math.max(0, SMTool._trackNodeDurationSeconds(entry)));
        entry.state.apply(entry.skeleton);
        entry.skeleton.updateWorldTransform(entry.physParam);
    } catch (e) {}
    entry._trackElapsed = elapsed;
};

// 返回一层中真正可绘制的 Spine 条目。层运行时对象可能就是链首条目本身，
// 因此绝不能再把其他链条目的 skeleton/state 回写到层对象上。
SMTool._firstRenderableLayerEntry = function (ls) {
    if (!ls) return null;
    var chain = ls._chainSkeletons || [];
    for (var i = 0; i < chain.length; i++) {
        var entry = chain[i];
        if (entry && !entry._isDelayer && !entry._isHider && !entry._isVirtualLayer &&
            entry.skeleton && entry.state) {
            return entry;
        }
    }
    return (!ls._isDelayer && !ls._isHider && !ls._isVirtualLayer &&
        ls.skeleton && ls.state) ? ls : null;
};

// 重置一整层的运行状态。用于自动大循环，避免只归零索引却保留上一轮 TrackTime。
SMTool._resetLayerRuntimeEntry = function (ls) {
    if (!ls) return;
    ls._chainDone = false;
    ls._chainIdx = 0;
    ls._chainElapsed = 0;
    ls._delayElapsed = 0;
    ls._loopTrack = { currentLoop: 0, totalElapsed: 0 };
    ls._nestedSubActive = false;
    ls._nestedLayerSkeletons = null;
    ls._hidePermanent = false;
    ls._hideRemaining = 0;
    ls._pendingHide = undefined;
    var chain = ls._chainSkeletons || [];
    for (var i = 0; i < chain.length; i++) {
        var entry = chain[i];
        if (entry && !entry._isDelayer && !entry._isHider && !entry._isVirtualLayer) {
            SMTool._resetLayerAnimationEntry(entry);
        }
    }
    // 新一轮在任何逻辑延时开始之前，都先锁定首个实际动画的第 0 帧。
    // 这里只保存绘制指针，不改写链首条目自己的 Spine 资源引用。
    ls._renderEntry = SMTool._firstRenderableLayerEntry(ls);
};

// 将并行播放的所有层作为一个同步批次重置，并立即绘制共同的第 0 帧。
// 自动大循环和浮窗“从头播放”按钮必须共用此入口，避免各层保留各自 TrackTime。
SMTool._restartLayerPreviewCycle = function (pp, now) {
    if (!pp || !pp._layerSkeletons || pp._layerSkeletons.length === 0) return;
    if (pp._parallelRestarting) return;
    pp._parallelRestarting = true;
    if (pp._loopRestartTimer) {
        clearTimeout(pp._loopRestartTimer);
        pp._loopRestartTimer = null;
    }

    try {
        var list = pp._layerSkeletons;
        for (var i = 0; i < list.length; i++) SMTool._resetLayerRuntimeEntry(list[i]);

        // 嵌套并行树也属于同一个屏障批次。缓存可以复用，但运行时状态必须一起归零。
        var cache = pp._subtreeCache || {};
        var cacheKeys = Object.keys(cache);
        for (var ci = 0; ci < cacheKeys.length; ci++) {
            var cachedTree = cache[cacheKeys[ci]];
            var cachedSkeletons = cachedTree && cachedTree.skeletons ? cachedTree.skeletons : [];
            for (var si = 0; si < cachedSkeletons.length; si++) {
                SMTool._resetLayerRuntimeEntry(cachedSkeletons[si]);
            }
            if (cachedTree && cachedTree.subTree) {
                cachedTree.nodeStates = SMTool._initPlaybackTreeState(cachedTree.subTree, null);
            }
        }

        pp._parallelCycleId = (pp._parallelCycleId || 0) + 1;
        pp._parallelBarrierCommitted = false;
        pp._allLayersCompletedOnce = false;
        if (pp._layerPlaybackState) pp._layerPlaybackState.treeCompleted = false;
        pp._startupDelayFrames = 0;
        pp._needsLayerReinit = false;
        pp._lastTime = now || performance.now();

        // 冻结状态下同步画两次，直接嵌套层也在同一原子批次显示第 0 帧。
        var wasFrozen = !!pp._flowFrozen;
        pp._flowFrozen = true;
        SMTool._renderLayerPreview(null, pp, pp._lastTime);
        SMTool._renderLayerPreview(null, pp, pp._lastTime);
        pp._flowFrozen = wasFrozen;
        pp._lastTime = now || performance.now();
    } finally {
        pp._parallelRestarting = false;
    }
};

/**
 * 为一层的链推进动画（更新 dt，判断 shouldAdvance，处理链切换）
 * @param ls      - 层骨架条目
 * @param dt      - 帧时间增量
 * @param frozen  - 是否冻结（true=不更新动画）
 * @returns { shouldAdvance, curIdx, chainLen, active } 
 */
SMTool._advanceLayerChain = function (ls, dt, frozen) {
    var chainLen = (ls._chainSkeletons && ls._chainSkeletons.length > 0) ? ls._chainSkeletons.length : 0;
    if (chainLen === 0) return { shouldAdvance: false, curIdx: 0, chainLen: 0, active: null };

    var curIdx = ls._chainIdx || 0;
    if (curIdx >= chainLen) curIdx = chainLen - 1;
    var active = ls._chainSkeletons[curIdx];
    var shouldAdvance = false;

    if (ls._chainDone || frozen) {
        // 冻结：不更新动画，保留最后一帧
    } else if (active && active._isDelayer) {
        if (ls._delayElapsed === undefined) ls._delayElapsed = 0;
        ls._delayElapsed += dt;
        if (ls._delayElapsed >= (active._delayValue || 1.0)) {
            shouldAdvance = true;
            ls._delayElapsed = 0;
        }
    }
    // ★★ 隐藏器节点：立即推进链，隐藏效果是渲染侧的事（不阻塞链）
    else if (active && active._isHider) {
        shouldAdvance = true;
        ls._pendingHide = active._hideValue;
        ls._pendingHideDir = active._hideDirection || 'right';
    } else if (active && active.state) {
        ls._delayElapsed = 0;
        var chainSpd = 1.0;
        var chainSrc = null;
        if (active._chainNodeId != null) {
            chainSrc = SMData.nodes.get(active._chainNodeId);
            if (chainSrc && typeof chainSrc._playbackSpeed === 'number') chainSpd = chainSrc._playbackSpeed;
        }
        if (!isFinite(chainSpd) || chainSpd === 0) chainSpd = 1.0;
        var activeTrackLoopMode = (chainSrc && chainSrc.loop !== false) ?
            (chainSrc._loopMode || ((chainSrc._loopCount !== undefined && chainSrc._loopCount !== 1) ? 'count' : null)) : null;
        if (active._trackMode && activeTrackLoopMode) {
            SMTool._maintainNativeTrackSequences(active, active.state, active._trackSequence, active.useVer);
        }
        if (active._trackMode) {
            SMTool._prepareTrackMixSlotGuard(active, active.state, active.skeleton);
            SMTool._resetTrackBoneBaseline(active, active.state, active.skeleton);
        }
        active.state.update(dt * chainSpd);
        active.state.apply(active.skeleton);
        active.skeleton.updateWorldTransform(active.physParam);
        if (active._trackMode) SMTool._applyTrackMixSlotGuard(active, active.state, active.skeleton);

        if (active._trackMode) {
            var sequenceDuration = SMTool._trackNodeDurationSeconds(active);
            active._trackElapsed = (active._trackElapsed || 0) + dt * Math.abs(chainSpd);
            var trackLoopMode = activeTrackLoopMode;
            if (trackLoopMode === 'time') {
                var configuredTime = Number(chainSrc._loopTime);
                if (!isFinite(configuredTime) || configuredTime < 0) configuredTime = sequenceDuration;
                shouldAdvance = configuredTime >= 0 && active._trackElapsed >= configuredTime;
            } else if (trackLoopMode === 'count') {
                var configuredCount = (chainSrc._loopCount !== undefined) ? Number(chainSrc._loopCount) : 1;
                shouldAdvance = configuredCount === -1 ? false : active._trackElapsed >= sequenceDuration * Math.max(1, configuredCount || 1);
                if (shouldAdvance) SMTool._freezeLayerTrackSequenceAtFinalFrame(active);
            } else {
                shouldAdvance = sequenceDuration <= 0 || active._trackElapsed >= sequenceDuration;
            }
            return { shouldAdvance: shouldAdvance, curIdx: curIdx, chainLen: chainLen, active: active };
        }
        var entry = active.state.getCurrent(0);
        if (entry) {
            var anim = entry.animation || entry._animation;
            if (anim) {
                var animDur = anim.duration || 1;
                // ★ 循环模式：显式设置了 _loopMode 或 _loopCount≠默认1（含-1无限循环）
                var loopMode = (chainSrc && chainSrc.loop !== false) ? (chainSrc._loopMode || ((chainSrc._loopCount !== undefined && chainSrc._loopCount !== 1) ? 'count' : null)) : null;
                // ★★ 强制动画内部循环：循环时间/次数模式下，track 必须 loop=true 才能持续播放
                if (loopMode && !entry.loop) { entry.loop = true; }
                if (!ls._loopTrack) ls._loopTrack = { currentLoop: 0, totalElapsed: 0 };
                if (loopMode === 'time') {
                    ls._loopTrack.totalElapsed += dt * chainSpd;
                    var loopTime = chainSrc._loopTime;
                    if (loopTime === undefined || loopTime === null) loopTime = animDur / Math.abs(chainSpd || 1);
                    if (ls._loopTrack.totalElapsed >= loopTime) shouldAdvance = true;
                } else if (loopMode === 'count') {
                    var curLoop = Math.floor(entry.trackTime / animDur);
                    if (curLoop > ls._loopTrack.currentLoop) ls._loopTrack.currentLoop = curLoop;
                    var loopCount = (chainSrc._loopCount !== undefined) ? chainSrc._loopCount : 1;
                    if (loopCount === -1) { shouldAdvance = false; }
                    else if (curLoop >= loopCount) {
                        // Spine 循环轨道在整轮边界会显示下一轮第 0 帧；屏障等待时必须改为
                        // 本动画真正的末帧，否则短分支看起来像独自重播了一次。
                        entry.loop = false;
                        entry.trackTime = animDur;
                        active.skeleton.setToSetupPose();
                        active.state.apply(active.skeleton);
                        active.skeleton.updateWorldTransform(active.physParam);
                        shouldAdvance = true;
                    }
                } else {
                    if (entry.trackTime >= animDur - 0.001) shouldAdvance = true;
                }
            }
        }
    }

    return { shouldAdvance: shouldAdvance, curIdx: curIdx, chainLen: chainLen, active: active };
};

/**
 * ★★ 渲染单层（含嵌套子层内联渲染）
 * @returns { activeNodeId, activeProgress, chainDone }
 */
SMTool._renderOneLayer = function (ls, dt, frozen, gl, WGL, pp) {
    var result = { activeNodeId: null, activeProgress: -1, chainDone: ls._chainDone || false };

    // ════════════════════════════════════════════════════════════
    // ★★ 嵌套子层模式：递归渲染子树的所有层（支持任意深度 A→B→C→...）
    // ════════════════════════════════════════════════════════════
    if (ls._nestedSubActive && ls._nestedLayerSkeletons && ls._nestedLayerSkeletons.length > 0) {
        var allNestedDone = true;
        var nestedSkeletons = ls._nestedLayerSkeletons;
        for (var ni = nestedSkeletons.length - 1; ni >= 0; ni--) {
            var ns = nestedSkeletons[ni];
            // UI 隐藏只抑制绘制，不能暂停时间线，否则该分支永远无法抵达栅栏。
            ns._suppressDraw = !!ls._suppressDraw || !!ns._hidden;

            // ★★ 递归调用：若 ns 自身也嵌套了更深层，递归处理
            var nsResult;
            if (ns._nestedSubActive && ns._nestedLayerSkeletons && ns._nestedLayerSkeletons.length > 0) {
                // 深层嵌套：递归渲染 ns 的子层
                nsResult = SMTool._renderOneLayer(ns, dt, frozen, gl, WGL, pp);
            } else {
                // 普通子层：正常链推进 + 渲染
                nsResult = SMTool._renderOneNormalLayer(ns, dt, frozen, gl, WGL, pp);
            }
            ns._suppressDraw = false;

            if (!nsResult.chainDone && !ns._chainDone) allNestedDone = false;
            if (nsResult.activeNodeId != null) result.activeNodeId = nsResult.activeNodeId;
            if (nsResult.activeProgress >= 0) result.activeProgress = nsResult.activeProgress;
        }

        // ★ 所有嵌套子层完成 → 父层该链标记完成
        if (allNestedDone) {
            ls._nestedSubActive = false;
            ls._nestedLayerSkeletons = null;
            ls._chainDone = true;
            result.chainDone = true;
            result.activeProgress = 1.0;
        }
        return result;
    }

    // ════════════════════════════════════════════════════════════
    // 普通模式：单层链渲染（非嵌套，或嵌套的最底层子层）
    // ════════════════════════════════════════════════════════════
    return SMTool._renderOneNormalLayer(ls, dt, frozen, gl, WGL, pp);
};

/**
 * ★★ 归一化单个 MVP 矩阵到根缩放值
 */
SMTool._normalizeMVP = function (mvp, pp) {
    if (!mvp || !pp) return;
    var zoom = pp._contentZoom || 1.0;
    var cw = pp._canvasWidth || 385;
    var ch = pp._canvasHeight || 645;
    mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
};

/**
 * ★★ 归一化层的 MVP 矩阵
 */
SMTool._normalizeLayerMVP = function (ls, pp) {
    if (!ls || !pp) return;
    if (ls.mvp) SMTool._normalizeMVP(ls.mvp, pp);
    if (ls.sceneRenderer) {
        var zoom = pp._contentZoom || 1;
        var cw = pp._canvasWidth || 385;
        var ch = pp._canvasHeight || 645;
        ls.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
        ls.sceneRenderer.camera.viewportWidth = cw / zoom;
        ls.sceneRenderer.camera.viewportHeight = ch / zoom;
        ls.sceneRenderer.camera.update();
    }
};

/**
 * ★★ 渲染一个"普通"层（非嵌套顶层，或嵌套最深层的叶子子层）
 * 处理：链推进 → 骨架渲染 → 嵌套检测 → 进度计算
 */
SMTool._renderOneNormalLayer = function (ls, dt, frozen, gl, WGL, pp) {
    var result = { activeNodeId: null, activeProgress: -1, chainDone: ls._chainDone || false };

    // ★★ 虚拟层节点（layer→layer 直接连线，无 spine 骨架）：立即激活嵌套子树
    if (ls._isVirtualLayer) {
        if (ls._nestedLayerNodeId && !ls._nestedSubActive) {
            var virtualPath = (ls._runtimePath || ('entry:' + (ls.layer || 0))) + '/layer:' + ls._nestedLayerNodeId;
            var subCache = SMTool._ensureSubtreeSkeletons(ls._nestedLayerNodeId, pp, { offX: ls._containerOffX || 0, offY: ls._containerOffY || 0 }, virtualPath);
            if (subCache && subCache.skeletons.length > 0) {
                ls._nestedLayerSkeletons = subCache.skeletons;
                ls._nestedSubActive = true;
            } else {
                ls._chainDone = true;
                result.chainDone = true;
            }
        }
        return result;
    }

    // ── 无链骨架的简单层 ──
    if (!ls._chainSkeletons || ls._chainSkeletons.length === 0) {
        if (!ls.skeleton || !ls.state) return result;
        if (!ls._chainDone && !frozen) { ls.state.update(dt); ls.state.apply(ls.skeleton); }
        ls.skeleton.updateWorldTransform(ls.physParam);
        if (ls._suppressDraw || ls._hidden) return result;
        var simple4x = !!ls.sceneRenderer;
        if (!simple4x && (!ls.shader || !ls.batcher || !ls.skeletonRenderer)) return result;
        // ★★ 归一化 MVP（简单层也需要统一缩放）
        SMTool._normalizeLayerMVP(ls, pp);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (simple4x) {
            try {
                ls.sceneRenderer.begin();
                ls.sceneRenderer.drawSkeleton(ls.skeleton, ls.premultipliedAlpha || false);
                ls.sceneRenderer.end();
            } catch (e4) {}
        } else {
            try { SMTool._renderLayerSkeletonInterleaved(ls, gl, WGL, SMData.nodes.get(ls.nodeId)); } catch (e) {
                ls.shader.bind(); ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
                ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);
                ls.batcher.begin(ls.shader); ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha || false;
                ls.skeletonRenderer.draw(ls.batcher, ls.skeleton); ls.batcher.end(); ls.shader.unbind();
            }
        }
        if (!ls._chainDone && ls.nodeId != null) result.activeNodeId = ls.nodeId;
        return result;
    }

    // ── 有链骨架：推进链动画 ──
    var adv = SMTool._advanceLayerChain(ls, dt, frozen);
    var curIdx = adv.curIdx;
    var chainLen = adv.chainLen;
    var active = adv.active;

    // ★ 链推进逻辑
    if (!ls._chainDone && !frozen && adv.shouldAdvance) {
        // 当前条目可能应用了临时 Slot Alpha 门控；离开条目前必须还原。
        if (active && active._trackMode) SMTool._restoreTrackMixSlotGuard(active);
        if (curIdx >= chainLen - 1) {
            // ★★ 链末尾：检查是否有嵌套并行节点
            if (ls._nestedLayerNodeId && !ls._nestedSubActive) {
                var nestedPath = (ls._runtimePath || ('entry:' + (ls.layer || 0))) + '/layer:' + ls._nestedLayerNodeId;
                var subCache = SMTool._ensureSubtreeSkeletons(ls._nestedLayerNodeId, pp, { offX: ls._containerOffX || 0, offY: ls._containerOffY || 0 }, nestedPath);
                if (subCache && subCache.skeletons.length > 0) {
                    ls._nestedLayerSkeletons = subCache.skeletons;
                    ls._nestedSubActive = true;
                    // 不设 chainDone，链的最后骨架保持渲染，嵌套子层覆盖其上
                } else {
                    ls._chainDone = true;
                    result.chainDone = true;
                }
            } else {
                ls._chainDone = true;
                result.chainDone = true;
            }
        } else {
            // 推进到链上下一个节点
            ls._chainIdx = curIdx + 1;
            ls._delayElapsed = 0;
            ls._loopTrack = { currentLoop: 0, totalElapsed: 0 };
            var next = ls._chainSkeletons[ls._chainIdx];
            if (next && !next._isDelayer && !next._isHider && next.state) {
                if (!SMTool._prepareLayerConnectionMix(active, next)) SMTool._resetLayerAnimationEntry(next);
            }
            // 后续同步和本帧绘制必须立即使用新条目，避免切换帧仍显示旧动画。
            active = next;
            curIdx = ls._chainIdx;
            // ★★ 切换后立即归一化新骨架的 MVP 和世界变换，消除抖动
            if (ls._chainSkeletons && ls._chainIdx < ls._chainSkeletons.length) {
                var switched = ls._chainSkeletons[ls._chainIdx];
                if (switched && switched.skeleton && switched.mvp) {
                    switched.skeleton.updateWorldTransform(switched.physParam);
                    SMTool._normalizeMVP(switched.mvp, pp);
                }
            }
        }
    }

    // ★ 活跃动画只通过独立绘制指针切换。不能把引用回写到 ls：
    // ls 通常就是 chain[0]，回写会永久污染首节点，令下一轮从错误画面开始。
    if (active && !active._isDelayer && !active._isHider && !active._isVirtualLayer &&
        active.skeleton && active.state) {
        ls._renderEntry = active;
    } else if (!ls._renderEntry) {
        ls._renderEntry = SMTool._firstRenderableLayerEntry(ls);
    }

    // ★★ 隐藏器效果：将隐藏参数从链条目转移到层状态
    if (ls._pendingHide !== undefined) {
        var ph = ls._pendingHide;
        ls._pendingHide = undefined;
        if (ph === -1) {
            ls._hidePermanent = true;
            ls._hideRemaining = 0;
        } else if (ph > 0) {
            ls._hideRemaining = ph;
            ls._hidePermanent = false;
        }
        // ph === 0 表示不隐藏
    }

    // ★★ 隐藏计时器递减
    if (ls._hideRemaining > 0) ls._hideRemaining -= dt;
    var isHidden = ls._hidePermanent || (ls._hideRemaining > 0);

    // ★ 渲染当前骨架（隐藏时跳过渲染，但动画照常推进）
    var drawEntry = ls._renderEntry || SMTool._firstRenderableLayerEntry(ls);
    var canRender4x = !!(drawEntry && drawEntry.skeleton && drawEntry.state && drawEntry.sceneRenderer);
    var canRender38 = !!(drawEntry && drawEntry.skeleton && drawEntry.state &&
        drawEntry.shader && drawEntry.batcher && drawEntry.skeletonRenderer);
    if (!isHidden && !ls._suppressDraw && (canRender4x || canRender38)) {
        drawEntry.skeleton.updateWorldTransform(drawEntry.physParam);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        var layerSrcNode = null;
        var ask = active && !active._isDelayer && !active._isHider ? active : drawEntry;
        if (ask && ask._chainNodeId != null) layerSrcNode = SMData.nodes.get(ask._chainNodeId);
        if (!layerSrcNode && ls.nodeId != null) layerSrcNode = SMData.nodes.get(ls.nodeId);
        if (canRender4x) {
            try {
                drawEntry.sceneRenderer.begin();
                drawEntry.sceneRenderer.drawSkeleton(drawEntry.skeleton, drawEntry.premultipliedAlpha || false);
                drawEntry.sceneRenderer.end();
            } catch (e4x) {}
        } else {
            try {
                SMTool._renderLayerSkeletonInterleaved(drawEntry, gl, WGL, layerSrcNode);
            } catch (e) {
                if (drawEntry.shader && drawEntry.batcher && drawEntry.skeletonRenderer && drawEntry.mvp) {
                drawEntry.shader.bind(); drawEntry.shader.setUniformi(WGL.Shader.SAMPLER, 0);
                drawEntry.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, drawEntry.mvp.values);
                drawEntry.batcher.begin(drawEntry.shader);
                drawEntry.skeletonRenderer.premultipliedAlpha = drawEntry.premultipliedAlpha || false;
                drawEntry.skeletonRenderer.draw(drawEntry.batcher, drawEntry.skeleton);
                drawEntry.batcher.end(); drawEntry.shader.unbind();
                }
            }
        }
    }
    if (active && active._trackMode) SMTool._restoreTrackMixSlotGuard(active);

    // ★ 收集活跃节点 ID
    var activeEntry = (ls._chainSkeletons && ls._chainSkeletons.length > 0) ? ls._chainSkeletons[ls._chainIdx || 0] : ls;
    var nid = activeEntry._chainNodeId || activeEntry.nodeId;
    if (nid != null && !ls._chainDone) result.activeNodeId = nid;

    // ★★ 计算播放进度（根据倍速 + 循环模式计算总时长比例）
    if (nid != null) {
        if (ls._chainDone) {
            result.activeProgress = 1.0;
        } else if (activeEntry._isDelayer) {
            var delTotal = Math.max((activeEntry._delayValue || 1), 0.001);
            result.activeProgress = Math.min(1, (ls._delayElapsed || 0) / delTotal);
        } else if (activeEntry._isHider) {
            var hvHide = activeEntry._hideValue;
            if (hvHide === -1 || hvHide === 0) {
                result.activeProgress = 1.0;
            } else {
                result.activeProgress = Math.min(1, (ls._delayElapsed || 0) / Math.max(hvHide, 0.001));
            }
        } else if (activeEntry._trackMode) {
            var trackTotal = Math.max(SMTool._trackNodeDurationSeconds(activeEntry), 0.001);
            result.activeProgress = Math.min(1, Math.max(0, (activeEntry._trackElapsed || 0) / trackTotal));
        } else if (activeEntry.state) {
            var te = activeEntry.state.getCurrent(0);
            if (te) {
                var anim = te.animation || te._animation || {};
                var animDur = anim.duration || 1;
                // 获取源节点信息
                var srcNode = (activeEntry._chainNodeId != null) ? SMData.nodes.get(activeEntry._chainNodeId) : null;
                var speed = (srcNode && typeof srcNode._playbackSpeed === 'number' && srcNode._playbackSpeed !== 0) ? Math.abs(srcNode._playbackSpeed) : 1.0;
                // ★ 循环模式：显式设置了 _loopMode 或 _loopCount≠默认1（含-1无限循环）
                var loopMode = (srcNode && srcNode.loop !== false) ? (srcNode._loopMode || ((srcNode._loopCount !== undefined && srcNode._loopCount !== 1) ? 'count' : null)) : null;

                if (loopMode === 'time') {
                    // 循环时间模式：totalElapsed / loopTime
                    var loopTime = srcNode._loopTime;
                    if (loopTime === undefined || loopTime === null) loopTime = animDur / speed;
                    var totalElapsed = (ls._loopTrack ? ls._loopTrack.totalElapsed : 0);
                    result.activeProgress = Math.min(1, totalElapsed / Math.max(loopTime, 0.001));
                } else if (loopMode === 'count') {
                    // 循环次数模式：(completedLoops * animDur + trackTime) / (loopCount * animDur)
                    var loopCount = (srcNode._loopCount !== undefined && srcNode._loopCount !== -1) ? srcNode._loopCount : 1;
                    var curLoop = ls._loopTrack ? ls._loopTrack.currentLoop : 0;
                    var trackInLoop = te.trackTime - curLoop * animDur;
                    if (trackInLoop < 0) trackInLoop = 0;
                    if (trackInLoop > animDur) trackInLoop = animDur;
                    var totalProgress = (curLoop * animDur + trackInLoop) / (loopCount * animDur);
                    result.activeProgress = Math.min(1, Math.max(0, totalProgress));
                } else {
                    // 默认单次：trackTime / animDur
                    result.activeProgress = Math.min(1, te.trackTime / Math.max(animDur, 0.001));
                }
            }
        }
    }

    return result;
};

/** ★ 渲染多层骨架到预览画布 — 先清屏(透明)，从底向上逐层绘制 */
SMTool._renderLayerPreview = function (layerNode, pp, now) {
    var list = pp._layerSkeletons; if (!list || list.length === 0) return;
    var gl = pp.gl, canvas = pp.canvas; if (!gl || !canvas) return;
    var WGL = window.spine38 && window.spine38.webgl;
    var has4xRenderer = false;
    for (var rvi = 0; rvi < list.length; rvi++) {
        var rvChain = list[rvi]._chainSkeletons || [list[rvi]];
        for (var rvci = 0; rvci < rvChain.length; rvci++) {
            if (rvChain[rvci] && rvChain[rvci].sceneRenderer) { has4xRenderer = true; break; }
        }
        if (has4xRenderer) break;
    }
    if (!has4xRenderer && (!WGL || !WGL.Shader)) return;

    var activeNodeIds = new Set();
    var allChainNodeIds = new Set();
    var activeNodeProgress = {};

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    if (pp._startupDelayFrames > 0) {
        pp._startupDelayFrames--;
        pp._lastTime = now;
        return;
    }

    var dt = Math.min((now - (pp._lastTime || now)) / 1000, 0.1);
    pp._lastTime = now;
    var frozen = pp._flowFrozen;

    // ★★ 每层独立渲染（含内联嵌套子树），互不干扰
    for (var i = list.length - 1; i >= 0; i--) {
        var ls = list[i];
        // 隐藏层继续执行，仅跳过绘制。
        ls._suppressDraw = !!ls._hidden;
        var r = SMTool._renderOneLayer(ls, dt, frozen, gl, WGL, pp);
        ls._suppressDraw = false;

        if (r.activeNodeId != null) activeNodeIds.add(r.activeNodeId);
        if (r.activeProgress >= 0 && r.activeNodeId != null) {
            activeNodeProgress[r.activeNodeId] = r.activeProgress;
        }

        // 收集链上所有节点 ID 用于置灰
        if (ls._chainSkeletons) {
            for (var csi = 0; csi < ls._chainSkeletons.length; csi++) {
                var cid = ls._chainSkeletons[csi]._chainNodeId;
                if (cid != null) allChainNodeIds.add(cid);
            }
        } else if (ls.nodeId != null) {
            allChainNodeIds.add(ls.nodeId);
        }
        // ★★ 递归收集嵌套子层的活跃节点和进度（支持 A→B→C 任意深度）
        SMTool._collectNestedActiveNodes(ls, activeNodeIds, activeNodeProgress, allChainNodeIds);
    }

    // ★ 同步主画布节点高亮
    SMTool._updateLayerPlayingHighlights(activeNodeIds, allChainNodeIds, activeNodeProgress);

    // ★ 实时刷新层级列表当前播放节点名
    SMTool._updateLayerListCurrentNodes();

    // ★★★ 实时刷新流面板分支节点高亮
    var anyBranchChanged = false;
    for (var bi2 = 0; bi2 < list.length; bi2++) {
        var lsBi = list[bi2];
        if (lsBi._chainIdx !== lsBi._lastRptChainIdx || !!lsBi._chainDone !== !!lsBi._lastRptChainDone) {
            anyBranchChanged = true;
            lsBi._lastRptChainIdx = lsBi._chainIdx;
            lsBi._lastRptChainDone = !!lsBi._chainDone;
        }
    }
    if (anyBranchChanged) SMTool._refreshFlowBranchHighlights();

    // ★★★ 栅栏同步：检查所有层是否都已完成
    if (!pp._flowFrozen && list.length > 0) {
        var allDone = true;
        for (var j = 0; j < list.length; j++) {
            if (!list[j]._chainDone) { allDone = false; break; }
        }
        if (allDone) {
            if (pp._parallelBarrierCommitted) return;
            pp._parallelBarrierCommitted = true;
            // 运行时 layer 条目会在其全部嵌套子树结束后才设置 _chainDone，
            // 因此 list 是唯一权威状态。旧 nodeStates 从未同步，会把已完成流程误判为未完成。
            pp._allLayersCompletedOnce = true;
            if (pp._layerPlaybackState) pp._layerPlaybackState.treeCompleted = true;

            // ★★★ 动画流推进
            var fb = SMData._fullPlayback;
            var owner = pp._playbackOwner;
            if (owner && owner.type === 'flow' && !owner.previewOnly &&
                fb && fb.isPlaying && fb.activePathIdx === owner.pathIdx) {
                var fpath = SMData._fullPaths[fb.activePathIdx];
                if (fpath && fb.currentStep < fpath.nodes.length) {
                    var fsn = fpath.nodes[fb.currentStep];
                    if (fsn && fsn.id === pp.nodeId && fsn._isLayerHub) {
                        fb.currentStep++;
                        if (fb.currentStep >= fpath.nodes.length) {
                            // ★ 播放到末尾 → 自动大循环
                            SMTool._restartFullPlaybackFromStart();
                        } else {
                            SMTool._playFullStep();
                        }
                        return;
                    }
                }
            }

            // 未在流播放中 → 全体层在同一个渲染批次共同回到第 0 帧。
            // 不再使用独立定时器，避免计时器与 requestAnimationFrame 形成不同步的新周期。
            SMTool._restartLayerPreviewCycle(pp, now);
            return;
        }
    }
};

/**
 * ★★ 递归收集嵌套子层的活跃节点 ID 和进度（支持 A→B→C→... 任意深度）
 */
SMTool._collectNestedActiveNodes = function (ls, activeNodeIds, activeNodeProgress, allChainNodeIds) {
    if (!ls._nestedSubActive || !ls._nestedLayerSkeletons) return;

    for (var ni = 0; ni < ls._nestedLayerSkeletons.length; ni++) {
        var ns = ls._nestedLayerSkeletons[ni];
        if (ns._hidden) continue;

        // 收集链骨架的节点 ID
        if (ns._chainSkeletons) {
            for (var ci = 0; ci < ns._chainSkeletons.length; ci++) {
                var cid = ns._chainSkeletons[ci]._chainNodeId;
                if (cid != null) allChainNodeIds.add(cid);
            }
        }
        if (ns.nodeId != null) allChainNodeIds.add(ns.nodeId);

        // 活跃节点和进度
        if (!ns._chainDone) {
            var activeEntry = (ns._chainSkeletons && ns._chainSkeletons.length > 0)
                ? ns._chainSkeletons[ns._chainIdx || 0]
                : ns;
            var nid = activeEntry._chainNodeId || activeEntry.nodeId;
            if (nid != null) {
                activeNodeIds.add(nid);
                // 计算进度（与 _renderOneNormalLayer 一致）
                if (activeEntry._isDelayer) {
                    var delTotal = Math.max((activeEntry._delayValue || 1), 0.001);
                    activeNodeProgress[nid] = Math.min(1, (ns._delayElapsed || 0) / delTotal);
                } else if (activeEntry._isHider) {
                    var hvHide2 = activeEntry._hideValue;
                    if (hvHide2 === -1 || hvHide2 === 0) {
                        activeNodeProgress[nid] = 1.0;
                    } else {
                        activeNodeProgress[nid] = Math.min(1, (ns._delayElapsed || 0) / Math.max(hvHide2, 0.001));
                    }
                } else if (activeEntry.state) {
                    var te = activeEntry.state.getCurrent(0);
                    if (te) {
                        var anim = te.animation || te._animation || {};
                        var animDur = anim.duration || 1;
                        var srcNode = (activeEntry._chainNodeId != null) ? SMData.nodes.get(activeEntry._chainNodeId) : null;
                        var speed = (srcNode && typeof srcNode._playbackSpeed === 'number' && srcNode._playbackSpeed !== 0) ? Math.abs(srcNode._playbackSpeed) : 1.0;
                        // ★ 循环模式：显式设置了 _loopMode 或 _loopCount≠默认1（含-1无限循环）
                        var loopMode = (srcNode && srcNode.loop !== false) ? (srcNode._loopMode || ((srcNode._loopCount !== undefined && srcNode._loopCount !== 1) ? 'count' : null)) : null;
                        if (loopMode === 'time') {
                            var loopTime = srcNode._loopTime;
                            if (loopTime === undefined || loopTime === null) loopTime = animDur / speed;
                            activeNodeProgress[nid] = Math.min(1, (ns._loopTrack ? ns._loopTrack.totalElapsed : 0) / Math.max(loopTime, 0.001));
                        } else if (loopMode === 'count') {
                            var loopCount = (srcNode._loopCount !== undefined && srcNode._loopCount !== -1) ? srcNode._loopCount : 1;
                            var curLoop = ns._loopTrack ? ns._loopTrack.currentLoop : 0;
                            var trackInLoop = te.trackTime - curLoop * animDur;
                            if (trackInLoop < 0) trackInLoop = 0;
                            activeNodeProgress[nid] = Math.min(1, Math.max(0, (curLoop * animDur + trackInLoop) / (loopCount * animDur)));
                        } else {
                            activeNodeProgress[nid] = Math.min(1, te.trackTime / Math.max(animDur, 0.001));
                        }
                    }
                }
            }
        } else {
            // 已完成层：进度 100%
            var doneEntry = (ns._chainSkeletons && ns._chainSkeletons.length > 0)
                ? ns._chainSkeletons[ns._chainIdx || 0]
                : ns;
            var doneNid = doneEntry._chainNodeId || doneEntry.nodeId;
            if (doneNid != null) {
                activeNodeIds.add(doneNid);
                activeNodeProgress[doneNid] = 1.0;
            }
        }

        // ★★ 递归收集更深层嵌套
        SMTool._collectNestedActiveNodes(ns, activeNodeIds, activeNodeProgress, allChainNodeIds);
    }
};

// ★ 同步主画布节点高亮 + 进度条：活跃节点粉色发光+进度条，非活跃链节点叠加暗色遮罩置灰
SMTool._updateLayerPlayingHighlights = function (activeNodeIds, allChainNodeIds, activeNodeProgress) {
    // 合并本帧所有涉及的节点 ID
    var allIds = new Set();
    if (SMData._layerPlayingNodes) SMData._layerPlayingNodes.forEach(function (id) { allIds.add(id); });
    if (SMData._layerAllChainNodes) SMData._layerAllChainNodes.forEach(function (id) { allIds.add(id); });
    activeNodeIds.forEach(function (id) { allIds.add(id); });
    allChainNodeIds.forEach(function (id) { allIds.add(id); });

    allIds.forEach(function (nid) {
        var el = SMTool._getEl(nid);
        if (!el) return;
        var isActive = activeNodeIds.has(nid);
        var isInChain = allChainNodeIds.has(nid);
        var progress = activeNodeProgress[nid];

        // 高亮：正在播放的节点
        if (isActive) {
            el.classList.add('playing-current');
        } else {
            el.classList.remove('playing-current');
        }

        // 置灰：在链中但非活跃的节点 → 叠加半透明暗色遮罩
        var existingOverlay = el.querySelector('.dim-overlay');
        if (isInChain && !isActive) {
            if (!existingOverlay) {
                var overlay = document.createElement('div');
                overlay.className = 'dim-overlay';
                el.appendChild(overlay);
            }
        } else {
            if (existingOverlay) existingOverlay.remove();
        }

        // ★ 进度条：活跃且有进度的节点显示 CSS 动画进度条（与动画流样式一致）
        var bar = el.querySelector('.anim-progress-bar');
        if (bar) {
            if (isActive && progress !== undefined && progress >= 0) {
                // 用 transform 直接设置进度（不用 CSS animation，每帧实时更新）
                bar.classList.remove('playing', 'paused');
                bar.style.animation = 'none';
                bar.style.opacity = '1';
                bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, progress)) + ')';
            } else if (!isActive && !isInChain) {
                // 不在链中的节点清除进度条
                bar.classList.remove('playing', 'paused');
                bar.style.animation = '';
                bar.style.opacity = '0';
                bar.style.transform = 'scaleX(0)';
            }
            // 置灰但非活跃的节点：保持进度条不可见（链推进时会重新激活）
            if (isInChain && !isActive) {
                bar.classList.remove('playing', 'paused');
                bar.style.animation = '';
                bar.style.opacity = '0';
                bar.style.transform = 'scaleX(0)';
            }
        }
        // ★ 延时器进度条：活跃时跟随延迟时间动画增长
        var dBar = el.querySelector('.delayer-progress-bar');
        if (dBar) {
            if (isActive && progress !== undefined && progress >= 0) {
                dBar.style.transition = 'none';
                dBar.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
                dBar.style.opacity = '1';
            } else if (isInChain && !isActive) {
                dBar.style.transition = 'none';
                dBar.style.width = '0%';
                dBar.style.opacity = '0';
            } else if (!isInChain) {
                dBar.style.transition = '';
                dBar.style.width = '0%';
                dBar.style.opacity = '';
            }
        }
    });

    // 保存供下一帧比对
    SMData._layerPlayingNodes = activeNodeIds;
    SMData._layerAllChainNodes = allChainNodeIds;
};

/** ★★ 递归更新嵌套子层的 MVP 矩阵（缩放继承） */
SMTool._updateNestedMVPs = function (skeletons, cw, ch, zoom) {
    if (!skeletons) return;
    for (var ri = 0; ri < skeletons.length; ri++) {
        var rls = skeletons[ri];
        if (rls._chainSkeletons) {
            for (var rci = 0; rci < rls._chainSkeletons.length; rci++) {
                var rsk = rls._chainSkeletons[rci];
                if (rsk.mvp) {
                    rsk.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
                }
                if (rsk.sceneRenderer) {
                    rsk.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                    rsk.sceneRenderer.camera.viewportWidth = cw / zoom;
                    rsk.sceneRenderer.camera.viewportHeight = ch / zoom;
                    rsk.sceneRenderer.camera.update();
                }
            }
        } else {
            if (rls.mvp) rls.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
            if (rls.sceneRenderer) {
                rls.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                rls.sceneRenderer.camera.viewportWidth = cw / zoom;
                rls.sceneRenderer.camera.viewportHeight = ch / zoom;
                rls.sceneRenderer.camera.update();
            }
        }
        // ★★ 递归更新嵌套子层
        if (rls._nestedSubActive && rls._nestedLayerSkeletons) {
            SMTool._updateNestedMVPs(rls._nestedLayerSkeletons, cw, ch, zoom);
        }
    }
};

/** 同步层级预览缩放 — 用标准 ortho 公式（与单节点一致）+ 统一 zoom */
SMTool._syncLayerPreviewViewport = function (pp, newW, newH) {
    if (!pp._layerSkeletons) return;
    var canvas = pp.canvas;
    var wrap = canvas ? canvas.parentElement : null;
    var cw = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : (newW || pp._canvasWidth || pp.panelW || 385);
    var ch = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : (newH || pp._canvasHeight || pp.panelH || 645);

    // ★ 检测画布尺寸是否变化（缩放 vs 拖拽面板边缘改变尺寸）
    var oldCw = pp._canvasWidth || cw;
    var oldCh = pp._canvasHeight || ch;
    var sizeChanged = (Math.abs(cw - oldCw) > 1 || Math.abs(ch - oldCh) > 1);
    
    var zoom = pp._contentZoom || 1.0;
    var layerNode = SMData.nodes.get(pp.nodeId);

    // ★ 纯缩放（尺寸未变）：只更新 MVP ortho 矩阵，不重置骨架位置，不 touch canvas 尺寸
    if (!sizeChanged) {
        for (var i = 0; i < pp._layerSkeletons.length; i++) {
            var ls = pp._layerSkeletons[i];
            if (ls._chainSkeletons) {
                for (var csi = 0; csi < ls._chainSkeletons.length; csi++) {
                    var csk = ls._chainSkeletons[csi];
                    if (csk.mvp) {
                        csk.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
                    }
                    if (csk.sceneRenderer) {
                        csk.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                        csk.sceneRenderer.camera.viewportWidth = cw / zoom;
                        csk.sceneRenderer.camera.viewportHeight = ch / zoom;
                        csk.sceneRenderer.camera.update();
                    }
                }
            } else {
                if (ls.mvp) ls.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
                if (ls.sceneRenderer) {
                    ls.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
                    ls.sceneRenderer.camera.viewportWidth = cw / zoom;
                    ls.sceneRenderer.camera.viewportHeight = ch / zoom;
                    ls.sceneRenderer.camera.update();
                }
            }
        }
        // ★★ 递归更新所有嵌套子层的 MVP（强制继承根节点缩放值）
        SMTool._updateNestedMVPs(pp._layerSkeletons, cw, ch, zoom);
        SMTool._updateAnimPreviewZoomLabel(zoom);
        return;
    }

    // ★ 尺寸变化：重新设置画布大小 + 重新居中 + 更新 MVP + 恢复已保存的位置偏移
    if (canvas) { canvas.width = cw; canvas.height = ch; }
    pp._canvasWidth = cw;
    pp._canvasHeight = ch;

    for (var i2 = 0; i2 < pp._layerSkeletons.length; i2++) {
        var ls2 = pp._layerSkeletons[i2];
        if (ls2._chainSkeletons) {
            for (var csi2 = 0; csi2 < ls2._chainSkeletons.length; csi2++) {
                SMTool._applyUnifiedZoomToSkeleton(ls2._chainSkeletons[csi2], cw, ch, zoom);
                var csk2 = ls2._chainSkeletons[csi2];
                if (csk2.skeleton) {
                    csk2._defaultSkX = csk2.skeleton.x;
                    csk2._defaultSkY = csk2.skeleton.y;
                }
            }
        } else {
            SMTool._applyUnifiedZoomToSkeleton(ls2, cw, ch, zoom);
            if (ls2.skeleton) {
                ls2._defaultSkX = ls2.skeleton.x;
                ls2._defaultSkY = ls2.skeleton.y;
            }
        }
    }
    // ★ 尺寸变化后重新应用已保存的位置偏移
    for (var li = 0; li < pp._layerSkeletons.length; li++) {
        var lsk = pp._layerSkeletons[li];
        if (lsk.layer && layerNode && layerNode._layerData && layerNode._layerData.layers[lsk.layer]) {
            var savedData = layerNode._layerData.layers[lsk.layer];
            var chainPositions = savedData._chainPositions;
            if (chainPositions) {
                var chain = lsk._chainSkeletons || [lsk];
                for (var cpi = 0; cpi < chain.length; cpi++) {
                    var csk3 = chain[cpi];
                    if (csk3.skeleton && csk3._chainNodeId != null) {
                        var cp = chainPositions[csk3._chainNodeId];
                        if (cp) {
                            csk3.skeleton.x = csk3._defaultSkX + (cp.offX || 0);
                            csk3.skeleton.y = csk3._defaultSkY + (cp.offY || 0);
                        }
                    }
                }
            }
            // ★ 兼容旧格式：单骨架位置偏移（posOffX/posOffY）
            if ((savedData.posOffX || savedData.posOffY) && lsk.skeleton && lsk._defaultSkX !== undefined) {
                lsk.skeleton.x = lsk._defaultSkX + (savedData.posOffX || 0);
                lsk.skeleton.y = lsk._defaultSkY + (savedData.posOffY || 0);
            }
        }
    }
    // ★★ 尺寸变化后也递归更新嵌套子层 MVP
    SMTool._updateNestedMVPs(pp._layerSkeletons, cw, ch, zoom);
    SMTool._updateAnimPreviewZoomLabel(zoom);
};

// ★ 对单个骨架应用统一缩放/居中
SMTool._applyUnifiedZoomToSkeleton = function (skelEntry, cw, ch, zoom) {
    if (!skelEntry) return;
    var ai = skelEntry.aspectInfo;
    if (ai && skelEntry.skeleton) {
        skelEntry.skeleton.x = cw / 2 - ai.centerX;
        skelEntry.skeleton.y = ch / 2 - ai.centerY;
    }
    if (skelEntry.mvp) {
        skelEntry.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
    }
    if (skelEntry.sceneRenderer) {
        skelEntry.sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
        skelEntry.sceneRenderer.camera.viewportWidth = cw / zoom;
        skelEntry.sceneRenderer.camera.viewportHeight = ch / zoom;
        skelEntry.sceneRenderer.camera.update();
    }
};

console.log('[LayerNode] 已加载');



// ================================================================
// 层级列表面板（预览浮窗左侧）
// ================================================================

// ★ 切换层级列表显隐
SMTool._toggleLayerList = function () {
    var list = document.getElementById('appLayerList');
    if (!list) return;
    var showing = list.style.display !== 'none';
    if (showing) {
        list.style.display = 'none';
    } else {
        SMTool._buildLayerList();
        list.style.display = 'flex';
    }
};

// ★ 获取某层当前播放的节点显示名（用于层级列表实时显示）
SMTool._getLayerCurNodeName = function (ls) {
    if (!ls) return '';
    var activeSkel = null;
    // 从链中找到当前活跃的骨架
    if (ls._chainSkeletons && ls._chainSkeletons.length > 0) {
        var idx = (typeof ls._chainIdx === 'number' && ls._chainIdx >= 0 && ls._chainIdx < ls._chainSkeletons.length) ? ls._chainIdx : 0;
        activeSkel = ls._chainSkeletons[idx];
    } else {
        activeSkel = ls;
    }
    if (!activeSkel) return '';
    var nid = activeSkel._chainNodeId || ls.nodeId;
    if (nid == null) return '';
    var node = SMData.nodes.get(nid);
    if (!node) return '';
    // ★ 动画节点：显示 currentAnim（动画状态名）；延时器：显示延时值；隐藏器：显示隐藏值
    if (node.nodeType === 'spine') {
        return node._trackMode ? (node._trackName || '轨道动画') :
            (node.currentAnim || (node.animations && node.animations.length > 0 ? node.animations[0].name : node.name || ''));
    } else if (node.nodeType === 'delayer' || node.nodeType === 'progDelayer') {
        return '⏱ 延时 ' + (node._delayValue || 1.0).toFixed(1) + 's';
    } else if (node.nodeType === 'hider') {
        var hv = (node._hideValue !== undefined) ? node._hideValue : -1;
        return '🙈 隐藏 ' + (hv === -1 ? '永久' : hv + 's');
    } else if (node.nodeType === 'layer') {
        return '📚 ' + (node.name || '并行播放');
    }
    return node.name || '';
};

// ★ 实时更新层级列表中每层的当前播放节点名（由 _renderLayerPreview 每帧调用）
SMTool._updateLayerListCurrentNodes = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    // ★ 仅当层级列表面板可见时才更新 DOM
    var listEl = document.getElementById('appLayerList');
    if (!listEl || listEl.style.display === 'none') return;

    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        var name = SMTool._getLayerCurNodeName(pp._layerSkeletons[i]);
        var el = document.getElementById('allCurNode-' + i);
        if (el && el.textContent !== name) {
            el.textContent = name;
        }
    }
    SMTool._updateLayerListThumbnails(performance.now(), false);
};

// 切换浮窗预览来源时同步层级列表，避免继续显示上一个并行组的缓存数据。
SMTool._syncLayerListPreviewMode = function (isLayerPreview, rebuild) {
    var trigger = document.getElementById('appLayerListTrigger');
    var list = document.getElementById('appLayerList');
    var content = document.getElementById('allListContent');
    if (trigger) trigger.style.display = isLayerPreview ? '' : 'none';
    if (!isLayerPreview) {
        if (list) list.style.display = 'none';
        if (content) content.innerHTML = '';
        return;
    }
    if (list && list.style.display !== 'none') {
        if (rebuild && typeof SMTool._buildLayerList === 'function') SMTool._buildLayerList();
        else if (content) content.innerHTML = '<div style="padding:12px;color:var(--text2);font-size:12px">层级数据加载中…</div>';
    }
};

// 层级列表实时缩略图：从主画布中当前活跃 Spine 节点的独立视口低频采样。
// 不再创建 Spine Runtime/纹理/WebGL 上下文，避免层数增加时缩略图反而拖慢主播放。
SMTool._updateLayerListThumbnails = function (now, force, onlyIdx) {
    var pp = SMData._animPreview;
    var listEl = document.getElementById('appLayerList');
    if (!pp || !pp._layerSkeletons || !listEl || listEl.style.display === 'none') return;
    if (!force && now - (pp._lastLayerThumbTime || 0) < 800) return; // 约 1.25fps，缩略图只表达状态
    pp._lastLayerThumbTime = now;

    var sourceCanvas = SMTool._sharedCanvas;
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return;
    var z = SMData.view.zoom || 1;

    var startIdx = typeof onlyIdx === 'number' ? onlyIdx : 0;
    var endIdx = typeof onlyIdx === 'number' ? Math.min(pp._layerSkeletons.length, onlyIdx + 1) : pp._layerSkeletons.length;
    for (var i = startIdx; i < endIdx; i++) {
        var ls = pp._layerSkeletons[i];
        var thumb = document.getElementById('allLayerThumb-' + i);
        if (!thumb) continue;
        var ctx = thumb.getContext('2d');
        if (!ctx) continue;
        if (!ls || ls._hidden) {
            ctx.clearRect(0, 0, thumb.width, thumb.height);
            continue;
        }

        var entry = ls._renderEntry;
        if (!entry && ls._chainSkeletons && ls._chainSkeletons.length > 0) {
            entry = ls._chainSkeletons[ls._chainIdx || 0];
        }
        if (!entry) entry = ls;
        var nodeId = entry._chainNodeId != null ? entry._chainNodeId : entry.nodeId;
        var node = nodeId != null ? SMData.nodes.get(nodeId) : null;
        // 节点被平移到主画布视口外时保留最后一次有效缓存；不能清空缩略图。
        if (!node || !node._canvasWidth || !node._canvasHeight || node._visible === false) continue;

        var nodeScale = node._customScale !== undefined ? node._customScale : 1;
        var pos = SMTool.worldToCanvas(node.x, node.y);
        var srcX = Math.round(pos.x);
        var srcY = Math.round(pos.y + (node._headerH || 70) * z * nodeScale);
        var srcW = Math.max(1, Math.round(node._canvasWidth * z * nodeScale));
        var srcH = Math.max(1, Math.round(node._canvasHeight * z * nodeScale));

        // 裁切到共享画布边界，避免节点临近视口边缘时 drawImage 失败。
        var clipX = Math.max(0, srcX);
        var clipY = Math.max(0, srcY);
        var clipR = Math.min(sourceCanvas.width, srcX + srcW);
        var clipB = Math.min(sourceCanvas.height, srcY + srcH);
        var clipW = clipR - clipX;
        var clipH = clipB - clipY;
        if (clipW <= 1 || clipH <= 1) continue;

        var inset = 6;
        var availW = thumb.width - inset * 2;
        var availH = thumb.height - inset * 2;
        var fit = Math.min(availW / clipW, availH / clipH);
        var dstW = clipW * fit;
        var dstH = clipH * fit;
        var dstX = (thumb.width - dstW) / 2;
        var dstY = (thumb.height - dstH) / 2;
        try {
            ctx.clearRect(0, 0, thumb.width, thumb.height);
            ctx.drawImage(sourceCanvas, clipX, clipY, clipW, clipH, dstX, dstY, dstW, dstH);
        } catch (e) {}
    }
};

SMTool._buildLayerList = function () {
    var content = document.getElementById('allListContent');
    if (!content) return;
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) { content.innerHTML = '<div style="padding:12px;color:var(--text2);font-size:12px">无层级数据</div>'; return; }

    // ★ 初始化位置模式状态
    if (!pp._layerPosMode) pp._layerPosMode = { active: false, selectedIndices: new Set(), _preEditOffsets: {} };

    var posMode = pp._layerPosMode;
    var isPosActive = posMode.active;
    var selSet = posMode.selectedIndices;

    // ★ 构建顶部工具栏 HTML（四方向箭头图标用CSS绘制）
    var toolbarHtml = '<div class="all-pos-toolbar">' +
        '<button class="all-pos-tool-btn' + (isPosActive ? ' active' : '') + '" id="allPosToolBtn" ' +
            'onclick="SMTool._toggleLayerPosMode()" title="' + (isPosActive ? '退出位置修改模式' : '进入位置修改模式（可Shift多选层，在预览面板拖拽移动）') + '">' +
            '<span class="all-pos-tool-icon"><i class="arr-t"></i><i class="arr-b"></i><i class="arr-l"></i><i class="arr-r"></i></span>' +
        '</button>' +
        '<div class="all-pos-tool-actions' + (isPosActive ? ' show' : '') + '" id="allPosToolActions">' +
            '<button class="pos-ok" onclick="SMTool._confirmAllLayerPositions()">✓ 确定</button>' +
            '<button class="pos-cancel" onclick="SMTool._cancelAllLayerPositions()">✗ 取消</button>' +
            '<button class="pos-reset" onclick="SMTool._resetAllLayerPositions()">↺ 默认</button>' +
        '</div>' +
    '</div>';

    // ★ 构建每层 HTML（无单独的位置图标）
    var html = toolbarHtml;
    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        var ls = pp._layerSkeletons[i];
        var layerNum = ls.layer || (i + 1);
        var fileName = '';
        // ★ 沿下游连线追溯找到第一个 Spine 动画节点，获取其源文件名
        if (ls.nodeId != null) {
            var resolved = SMTool._resolveAnimNodeDownstream(ls.nodeId);
            var displayNode = resolved.animNode;
            if (displayNode && displayNode.nodeType === 'spine' && displayNode.sourceFile) {
                fileName = displayNode.sourceFile;
            }
        }
        // 兜底：如果追溯失败，尝试从链首骨架获取
        if (!fileName && ls._chainSkeletons && ls._chainSkeletons.length > 0) {
            for (var ci = 0; ci < ls._chainSkeletons.length; ci++) {
                var cNode = SMData.nodes.get(ls._chainSkeletons[ci]._chainNodeId);
                if (cNode && cNode.nodeType === 'spine' && cNode.sourceFile) {
                    fileName = cNode.sourceFile;
                    break;
                }
            }
        }
        fileName = fileName || ('层' + layerNum);

        var isHidden = ls._hidden;
        var isSelected = isPosActive && selSet.has(i);
        // ★ 获取当前播放的节点名称
        var curNodeName = SMTool._getLayerCurNodeName(ls);
        html += '<div class="all-item' + (isHidden ? ' hidden-layer' : '') + (isSelected ? ' selected' : '') + (isPosActive ? ' pos-mode-hover' : '') + '" ' +
            'data-layer-idx="' + i + '" ' +
            'onclick="SMTool._onLayerItemClick(event,' + i + ')" title="' + (isPosActive ? '点击选择/取消层（Shift+点击范围连选）' : '') + '">' +
            '<canvas class="all-layer-thumb" id="allLayerThumb-' + i + '" width="144" height="208" aria-label="L' + layerNum + ' 动画缩略图"></canvas>' +
            '<div class="all-item-main">' +
                '<div class="all-item-row1">' +
                    '<span class="all-item-layer">L' + layerNum + '</span>' +
                    '<span class="all-item-file" title="' + SMTool._esc(fileName) + '">' + SMTool._esc(fileName) + '</span>' +
                '</div>' +
                '<div class="all-item-row2">' +
                    '<button class="all-btn' + (isHidden ? '' : ' active') + '" onclick="event.stopPropagation();SMTool._toggleLayerVisibility(' + i + ')" title="' + (isHidden ? '显示' : '隐藏') + '层级">👁</button>' +
                '</div>' +
            '</div>' +
            '<span class="all-item-cur-node" id="allCurNode-' + i + '">' + SMTool._esc(curNodeName) + '</span>' +
        '</div>';
    }
    // ★ 底部选中数量提示（位置模式激活时显示）
    html += '<div class="all-pos-footer' + (isPosActive && selSet.size > 0 ? ' show' : '') + '" id="allPosFooter">' +
        (isPosActive && selSet.size > 0 ? '📍 已选 ' + selSet.size + ' 层 — 在预览面板拖拽移动' : '') +
    '</div>';
    content.innerHTML = html;
    SMTool._updateLayerListThumbnails(performance.now(), true);
};

// ★ 切换层级显隐
SMTool._toggleLayerVisibility = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];
    ls._hidden = !ls._hidden;
    // 不重建整个列表，否则其他层的缩略图缓存会被一并销毁。
    var item = document.querySelector('.all-item[data-layer-idx="' + idx + '"]');
    if (item) {
        item.classList.toggle('hidden-layer', !!ls._hidden);
        var button = item.querySelector('.all-btn');
        if (button) {
            button.classList.toggle('active', !ls._hidden);
            button.title = ls._hidden ? '显示层级' : '隐藏层级';
        }
    }
    SMTool._updateLayerListThumbnails(performance.now(), true, idx);
};

// ★ 层级列表项点击（位置模式下 shift范围连选，普通模式下无操作）
SMTool._onLayerItemClick = function (e, idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var posMode = pp._layerPosMode;
    if (!posMode || !posMode.active) return; // 非位置模式不处理

    e.stopPropagation();
    if (!posMode.selectedIndices) posMode.selectedIndices = new Set();
    var selSet = posMode.selectedIndices;

    if (e.shiftKey && typeof posMode._lastClickedIdx === 'number' && posMode._lastClickedIdx >= 0) {
        // ★ Shift+点击：范围连选（从上次点击的索引到当前点击的索引之间的所有层）
        var from = Math.min(posMode._lastClickedIdx, idx);
        var to = Math.max(posMode._lastClickedIdx, idx);
        for (var i = from; i <= to; i++) {
            selSet.add(i);
        }
    } else if (e.shiftKey) {
        // Shift但无上次索引 → 当作切换当前项
        if (selSet.has(idx)) {
            selSet.delete(idx);
        } else {
            selSet.add(idx);
        }
    } else {
        // 普通点击：单选（如果仅此一项已选中则取消，否则替换为仅选此项）
        if (selSet.size === 1 && selSet.has(idx)) {
            selSet.clear();
        } else {
            selSet.clear();
            selSet.add(idx);
        }
    }
    // ★ 记录最后点击的索引（用于下次Shift范围连选）
    posMode._lastClickedIdx = idx;
    SMTool._buildLayerList();
};

// ★ 切换全局位置修改模式
SMTool._toggleLayerPosMode = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    if (!pp._layerPosMode) pp._layerPosMode = { active: false, selectedIndices: new Set(), _preEditOffsets: {} };

    var posMode = pp._layerPosMode;
    if (posMode.active) {
        // 退出位置模式（不保存，等同于取消）
        SMTool._cancelAllLayerPositions();
    } else {
        // 进入位置模式
        posMode.active = true;
        if (!posMode.selectedIndices) posMode.selectedIndices = new Set();
        posMode.selectedIndices.clear();
        if (!posMode._preEditOffsets) posMode._preEditOffsets = {};

        // ★ 保存所有层的进入前偏移（用于取消时恢复）
        var layerNode = SMData.nodes.get(pp.nodeId);
        posMode._preEditOffsets = {};
        for (var i = 0; i < pp._layerSkeletons.length; i++) {
            var ls = pp._layerSkeletons[i];
            var layerNum = ls.layer || (i + 1);
            var curOff = { offX: 0, offY: 0 };
            if (layerNode && layerNode._layerData && layerNode._layerData.layers[layerNum] && layerNode._layerData.layers[layerNum]._containerOffset) {
                curOff.offX = layerNode._layerData.layers[layerNum]._containerOffset.offX || 0;
                curOff.offY = layerNode._layerData.layers[layerNum]._containerOffset.offY || 0;
            }
            posMode._preEditOffsets[i] = curOff;
            // ★ 保存当前骨架的实际位置（用于取消时精确定位恢复）
            ls._preEditSkelPositions = [];
            var _collectSkels = function (entry) {
                if (!entry) return;
                var chain = entry._chainSkeletons;
                if (chain && chain.length > 0) {
                    for (var cj = 0; cj < chain.length; cj++) {
                        if (chain[cj].skeleton) ls._preEditSkelPositions.push({ sk: chain[cj].skeleton, x: chain[cj].skeleton.x, y: chain[cj].skeleton.y });
                    }
                } else if (entry.skeleton) {
                    ls._preEditSkelPositions.push({ sk: entry.skeleton, x: entry.skeleton.x, y: entry.skeleton.y });
                }
            };
            _collectSkels(ls);
        }
        pp._layerDragTargetIdx = -1; // 清空旧的单层拖拽目标
    }
    SMTool._buildLayerList();
};

// ★ 确定所有选中层的位置（写入 _containerOffset 到 layerData，持久化到 JSON）
SMTool._confirmAllLayerPositions = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    var posMode = pp._layerPosMode;
    if (!posMode || !posMode.active) return;

    var layerNode = SMData.nodes.get(pp.nodeId);
    var selSet = posMode.selectedIndices;

    // 如果没有选中任何层，则保存所有层
    var targetIndices = (selSet && selSet.size > 0) ? Array.from(selSet) : [];
    if (targetIndices.length === 0) {
        for (var i = 0; i < pp._layerSkeletons.length; i++) targetIndices.push(i);
    }

    // ★ 辅助：递归查找锚点骨架
    var _findAnchor = function (entry) {
        if (!entry) return null;
        var ch = entry._chainSkeletons;
        if (ch && ch.length > 0) {
            for (var cj = 0; cj < ch.length; cj++) {
                if (ch[cj].skeleton && ch[cj]._defaultSkX !== undefined) return ch[cj];
            }
        }
        if (entry.skeleton && entry._defaultSkX !== undefined) return entry;
        if (entry._nestedLayerSkeletons) {
            for (var nj = 0; nj < entry._nestedLayerSkeletons.length; nj++) {
                var found = _findAnchor(entry._nestedLayerSkeletons[nj]);
                if (found) return found;
            }
        }
        return null;
    };

    for (var ti = 0; ti < targetIndices.length; ti++) {
        var idx = targetIndices[ti];
        if (idx >= pp._layerSkeletons.length) continue;
        var ls = pp._layerSkeletons[idx];
        var layerNum = ls.layer || (idx + 1);

        if (layerNode && layerNode._layerData) {
            var ld = layerNode._layerData;
            if (!ld.layers[layerNum]) ld.layers[layerNum] = {};

            var anchorSkel = _findAnchor(ls);
            if (anchorSkel) {
                ld.layers[layerNum]._containerOffset = {
                    offX: anchorSkel.skeleton.x - anchorSkel._defaultSkX,
                    offY: anchorSkel.skeleton.y - anchorSkel._defaultSkY
                };
            } else {
                // 兜底：用拖拽增量
                var positions = pp._layerDragStartPositions;
                var dragOffX = 0, dragOffY = 0;
                if (positions && positions.length > 0) {
                    for (var pi = 0; pi < positions.length; pi++) {
                        if (positions[pi].sk && typeof positions[pi].sk.x === 'number') {
                            dragOffX = positions[pi].sk.x - positions[pi].x;
                            dragOffY = positions[pi].sk.y - positions[pi].y;
                            break;
                        }
                    }
                }
                var oldOff = ld.layers[layerNum]._containerOffset || { offX: 0, offY: 0 };
                ld.layers[layerNum]._containerOffset = {
                    offX: oldOff.offX + dragOffX,
                    offY: oldOff.offY + dragOffY
                };
            }
            delete ld.layers[layerNum].posOffX;
            delete ld.layers[layerNum].posOffY;
            delete ld.layers[layerNum]._chainPositions;
            ls._containerOffX = ld.layers[layerNum]._containerOffset.offX;
            ls._containerOffY = ld.layers[layerNum]._containerOffset.offY;
        }
    }
    pp._subtreeCache = {};

    // ★ 退出位置模式
    posMode.active = false;
    posMode.selectedIndices.clear();
    pp._layerDragTargetIdx = -1;
    SMTool._buildLayerList();
    document.getElementById('sbStatus').textContent = '✅ 已保存 ' + targetIndices.length + ' 层的位置';
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
};

// ★ 取消所有选中层的位置修改（恢复到进入模式前的位置）
SMTool._cancelAllLayerPositions = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    var posMode = pp._layerPosMode;
    if (!posMode) { pp._layerDragTargetIdx = -1; SMTool._buildLayerList(); return; }

    // ★ 恢复所有层骨架到进入模式前的位置
    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        var ls = pp._layerSkeletons[i];
        if (ls._preEditSkelPositions) {
            for (var pi = 0; pi < ls._preEditSkelPositions.length; pi++) {
                var sp = ls._preEditSkelPositions[pi];
                sp.sk.x = sp.x;
                sp.sk.y = sp.y;
            }
        }
    }

    posMode.active = false;
    if (posMode.selectedIndices) posMode.selectedIndices.clear();
    pp._layerDragTargetIdx = -1;
    pp._layerDragActive = false;
    SMTool._buildLayerList();
};

// ★ 恢复所有选中层的默认位置（清除容器偏移，回到初始居中）
SMTool._resetAllLayerPositions = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    var posMode = pp._layerPosMode;
    if (!posMode || !posMode.active) return;

    var layerNode = SMData.nodes.get(pp.nodeId);
    var selSet = posMode.selectedIndices;

    // 如果没有选中任何层，则重置所有层
    var targetIndices = (selSet && selSet.size > 0) ? Array.from(selSet) : [];
    if (targetIndices.length === 0) {
        for (var i = 0; i < pp._layerSkeletons.length; i++) targetIndices.push(i);
    }

    for (var ti = 0; ti < targetIndices.length; ti++) {
        var idx = targetIndices[ti];
        if (idx >= pp._layerSkeletons.length) continue;
        var ls = pp._layerSkeletons[idx];
        var layerNum = ls.layer || (idx + 1);

        // 恢复所有链骨架到默认居中位置
        var _resetChain = function (entry) {
            if (!entry) return;
            var chain = entry._chainSkeletons;
            if (chain && chain.length > 0) {
                for (var cj = 0; cj < chain.length; cj++) {
                    if (chain[cj].skeleton && chain[cj]._defaultSkX !== undefined) {
                        chain[cj].skeleton.x = chain[cj]._defaultSkX;
                        chain[cj].skeleton.y = chain[cj]._defaultSkY;
                    }
                }
            } else if (entry.skeleton && entry._defaultSkX !== undefined) {
                entry.skeleton.x = entry._defaultSkX;
                entry.skeleton.y = entry._defaultSkY;
            }
        };
        _resetChain(ls);

        // 清除工程中的容器偏移
        if (layerNode && layerNode._layerData && layerNode._layerData.layers[layerNum]) {
            delete layerNode._layerData.layers[layerNum]._containerOffset;
            delete layerNode._layerData.layers[layerNum].posOffX;
            delete layerNode._layerData.layers[layerNum].posOffY;
        }
    }

    pp._subtreeCache = {};
    SMTool._buildLayerList();
    document.getElementById('sbStatus').textContent = '↺ 已恢复 ' + targetIndices.length + ' 层到默认位置';
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
};

// ★ 鼠标按下：开始拖拽所有选中层的位置（位置修改模式下）
SMTool._onLayerPosMouseDown = function (e) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) return;
    var posMode = pp._layerPosMode;
    if (!posMode || !posMode.active) return;

    var selSet = posMode.selectedIndices;
    // 没有选中任何层 → 不响应拖拽
    if (!selSet || selSet.size === 0) return;

    var canvas = pp.canvas || document.getElementById('appCanvas');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

    // ★★ 收集所有选中层的所有可见骨架（含嵌套子层，递归），用于整体移位
    var allPositions = []; // [{ sk, x, y }]
    var selArr = Array.from(selSet);
    for (var si = 0; si < selArr.length; si++) {
        var idx = selArr[si];
        if (idx >= pp._layerSkeletons.length) continue;
        var ls = pp._layerSkeletons[idx];

        var _collectAll = function (entry) {
            if (!entry) return;
            var chain = entry._chainSkeletons;
            if (chain && chain.length > 0) {
                for (var cj = 0; cj < chain.length; cj++) {
                    if (chain[cj].skeleton) allPositions.push({ sk: chain[cj].skeleton, x: chain[cj].skeleton.x, y: chain[cj].skeleton.y });
                }
            } else if (entry.skeleton) {
                allPositions.push({ sk: entry.skeleton, x: entry.skeleton.x, y: entry.skeleton.y });
            }
            // 递归收集嵌套子层
            if (entry._nestedSubActive && entry._nestedLayerSkeletons) {
                for (var nj = 0; nj < entry._nestedLayerSkeletons.length; nj++) {
                    _collectAll(entry._nestedLayerSkeletons[nj]);
                }
            }
        };
        _collectAll(ls);
    }

    if (allPositions.length === 0) return;

    // ★★ 阻止事件冒泡，防止触发画布级操作
    e.preventDefault();
    e.stopPropagation();
    pp._layerDragActive = true;
    pp._layerDragStartX = e.clientX;
    pp._layerDragStartY = e.clientY;
    pp._layerDragStartPositions = allPositions;
};

// ★ 鼠标移动：拖拽所有选中层的位置（同步移动）
SMTool._onLayerPosMouseMove = function (e) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerDragActive) return;
    var posMode = pp._layerPosMode;
    if (!posMode || !posMode.active) return;

    e.stopPropagation();
    var zoom = pp._contentZoom || 1.0;
    var dx = (e.clientX - pp._layerDragStartX) / zoom;
    var dy = (e.clientY - pp._layerDragStartY) / zoom;
    // ★ 将所有选中层的骨架移动相同的位移量
    var positions = pp._layerDragStartPositions;
    if (positions) {
        for (var pi = 0; pi < positions.length; pi++) {
            positions[pi].sk.x = positions[pi].x + dx;
            positions[pi].sk.y = positions[pi].y - dy;
        }
    }
};

// ★ 鼠标释放：结束拖拽（不自动保存，由确认/取消按钮控制）
SMTool._onLayerPosMouseUp = function () {
    var pp = SMData._animPreview;
    if (!pp) return;
    if (!pp._layerDragActive) { pp._layerDragActive = false; return; }
    pp._layerDragActive = false;
    // ★ 不再自动保存，位置修改由 confirm/cancel 按钮控制
};

// ★ 清除所有层级高亮、置灰遮罩和进度条（关闭预览时调用）
SMTool._clearAllLayerHighlights = function () {
    var allIds = new Set();
    if (SMData._layerPlayingNodes) SMData._layerPlayingNodes.forEach(function (id) { allIds.add(id); });
    if (SMData._layerAllChainNodes) SMData._layerAllChainNodes.forEach(function (id) { allIds.add(id); });
    allIds.forEach(function (nid) {
        var el = SMTool._getEl(nid);
        if (!el) return;
        el.classList.remove('playing-current');
        var d = el.querySelector('.dim-overlay');
        if (d) d.remove();
        var b = el.querySelector('.anim-progress-bar');
        if (b) { b.style.opacity = '0'; b.style.transform = 'scaleX(0)'; b.style.animation = ''; b.classList.remove('playing', 'paused'); }
        var db = el.querySelector('.delayer-progress-bar');
        if (db) { db.style.width = '0%'; db.style.opacity = ''; db.style.transition = ''; }
    });
    SMData._layerPlayingNodes = null;
    SMData._layerAllChainNodes = null;
    // ★★ 清理嵌套播放树状态
    var pp = SMData._animPreview;
    if (pp) {
        pp._playbackTree = null;
        pp._layerPlaybackState = null;
        pp._subtreeCache = {};
        if (pp._layerSkeletons) {
            for (var si = 0; si < pp._layerSkeletons.length; si++) {
                pp._layerSkeletons[si]._nestedSubActive = false;
                pp._layerSkeletons[si]._nestedSwitchPending = false;
            }
        }
    }
};

console.log('[LayerNode] 层级节点模块已加载');
