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
            var linkedNode = SMData.nodes.get(layerInfo.animNodeId);
            if (linkedNode) {
                displayText = SMTool._esc(linkedNode.sourceFile || linkedNode.name || '动画节点');
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
                var linkedNode = SMData.nodes.get(layerInfo.animNodeId);
                if (linkedNode) {
                    displayText = SMTool._esc(linkedNode.sourceFile || linkedNode.name || '动画节点');
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
            SMTool._updateSel();
            return;
        }
    }

    // 回退：无 DOM 信息时仅记录节点
    SMData.connecting = { nodeId: nid, stateName: 'layer_' + layerNum, dotType: dotType };
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
            var tn2 = SMData.nodes.get(toNid);
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
        var boxes = el.querySelectorAll('.layer-box-text');
        var ld = SMTool._layerData(ln);
        var nodeConns = connIndex[ln.id] || {};
        for (var li = 0; li < boxes.length; li++) {
            var lnum = li + 1;
            var txt = '请连线动画节点';
            var cinfo = nodeConns[lnum];
            if (cinfo && cinfo.toNodeObj) {
                txt = (cinfo.toNodeObj.sourceFile || cinfo.toNodeObj.name || '动画节点') + (cinfo.toNodeObj.currentAnim ? ' — ' + cinfo.toNodeObj.currentAnim : '');
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

/** 为层级节点设置浮窗预览 — 统一加载所有连线节点到预览 GL */
SMTool._showLayerPreview = function (layerNode) {
    var pp = SMData._animPreview;
    var ld = SMTool._layerData(layerNode);
    var panel = document.getElementById('animPreviewPanel');
    var canvas = document.getElementById('appCanvas');
    if (!panel || !canvas) return;

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
            // ★ 接受 Spine 动画节点 或 延时器节点
            if (tn && (tn.nodeType === 'spine' || tn.nodeType === 'delayer')) {
                var hasRes = (tn.nodeType === 'delayer') || (tn._srcAtlasText && (tn._srcSkelJson || tn._srcSkelBinBase64) && (tn.textureImg || (tn._texImgs && tn._texImgs.length > 0)));
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
                if (ln2 && (ln2.nodeType === 'spine' || ln2.nodeType === 'delayer')) {
                    var hasRes2 = (ln2.nodeType === 'delayer') || (ln2._srcAtlasText && (ln2._srcSkelJson || ln2._srcSkelBinBase64) && (ln2.textureImg || (ln2._texImgs && ln2._texImgs.length > 0)));
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

    // 销毁旧预览
    // ★ 保存当前层的位置拖拽激活状态（barrier 重新初始化后恢复）
    var savedDragIdx = pp._layerDragTargetIdx;
    var savedDragLayer = (savedDragIdx >= 0 && pp._layerSkeletons && savedDragIdx < pp._layerSkeletons.length)
        ? pp._layerSkeletons[savedDragIdx].layer : -1;
    SMTool._destroyAnimPreview();
    panel.style.display = 'flex';
    pp.visible = true;
    pp.nodeId = layerNode.id;

    // 确定 Spine 版本 — 优先从直连 Spine 节点获取，全是延时器时沿链查找
    var firstNode = null;
    for (var fni = 0; fni < linkedNodes.length; fni++) {
        if (linkedNodes[fni].node.nodeType === 'spine') { firstNode = linkedNodes[fni].node; break; }
    }
    // ★ 全延时器兜底：沿每个延时器的出边链找到第一个 Spine 动画节点
    if (!firstNode) {
        for (var fni2 = 0; fni2 < linkedNodes.length; fni2++) {
            var lnk = linkedNodes[fni2];
            if (lnk.node.nodeType === 'delayer') {
                var chainIds = SMTool._buildChainFromNode(lnk.node.id);
                for (var ci = 0; ci < chainIds.length; ci++) {
                    var cn = SMData.nodes.get(chainIds[ci]);
                    if (cn && cn.nodeType === 'spine') { firstNode = cn; break; }
                }
                if (firstNode) break;
            }
        }
    }
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

    // ★ 统一加载所有层（含动画链）
    var layerSkeletons = [];
    for (var lj = 0; lj < linkedNodes.length; lj++) {
        var item = linkedNodes[lj];
        // ★ 构建从直接连线节点出发的动画链
        var chainIds = SMTool._buildChainFromNode(item.node.id);
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
            else if (chainNode && chainNode.nodeType === 'delayer') {
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
            // ★ 循环追踪：记录当前循环次数和已流逝时间（动画流/并行播放循环控制）
            firstSk._loopTrack = { currentLoop: 0, totalElapsed: 0 };
            // ★ 若链首是延时器，从链上第一个 Spine 节点预取渲染器属性
            if (firstSk._isDelayer) {
                firstSk._delayElapsed = 0;
                for (var csi2 = 0; csi2 < chainSkeletons.length; csi2++) {
                    var pre = chainSkeletons[csi2];
                    if (pre && !pre._isDelayer && pre.skeleton) {
                        firstSk.skeleton = pre.skeleton;
                        firstSk.state = pre.state;
                        firstSk.shader = pre.shader;
                        firstSk.batcher = pre.batcher;
                        firstSk.skeletonRenderer = pre.skeletonRenderer;
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
                            if (srcNode2 && srcNode2.loop !== false && srcNode2._loopMode) {
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
    // ★ 保存每层的默认骨架位置（用于位置拖拽的"恢复默认"）
    for (var lk = 0; lk < layerSkeletons.length; lk++) {
        var lsk = layerSkeletons[lk];
        if (lsk.skeleton) {
            lsk._defaultSkX = lsk.skeleton.x;
            lsk._defaultSkY = lsk.skeleton.y;
        }
    }
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
                if (csk.skeleton && csk.aspectInfo) {
                    // ★ 计算默认居中位置
                    var defX = cw / 2 - csk.aspectInfo.centerX;
                    var defY = ch / 2 - csk.aspectInfo.centerY;
                    csk._defaultSkX = defX;
                    csk._defaultSkY = defY;
                    // ★ 一步到位：若已保存偏移 → 居中 + 偏移，否则 → 居中
                    var cp = (chainPositions && csk._chainNodeId != null) ? chainPositions[csk._chainNodeId] : null;
                    csk.skeleton.x = defX + (cp ? (cp.offX || 0) : 0);
                    csk.skeleton.y = defY + (cp ? (cp.offY || 0) : 0);
                }
            }
        } else if (lsi.mvp && lsi.aspectInfo) {
            lsi.mvp.ortho2d(cw / 2 - cw / (2 * savedZoom), ch / 2 - ch / (2 * savedZoom), cw / savedZoom, ch / savedZoom);
            if (lsi.skeleton) {
                var defX2 = cw / 2 - lsi.aspectInfo.centerX;
                var defY2 = ch / 2 - lsi.aspectInfo.centerY;
                lsi._defaultSkX = defX2;
                lsi._defaultSkY = defY2;
                // ★ 兼容旧格式：单骨架位置偏移
                var offX2 = (savedData && savedData.posOffX) ? savedData.posOffX : 0;
                var offY2 = (savedData && savedData.posOffY) ? savedData.posOffY : 0;
                lsi.skeleton.x = defX2 + offX2;
                lsi.skeleton.y = defY2 + offY2;
            }
        }
    }
    SMTool._updateAnimPreviewZoomLabel(savedZoom);

    pp._layerSkeletons = layerSkeletons;
    // ★ 恢复之前激活的位置拖拽模式（barrier 重新初始化后保持激活状态）
    if (savedDragLayer >= 0) {
        for (var sdi = 0; sdi < layerSkeletons.length; sdi++) {
            if (layerSkeletons[sdi].layer === savedDragLayer) {
                pp._layerDragTargetIdx = sdi;
                layerSkeletons[sdi]._positionDragActive = true;
                if (layerSkeletons[sdi].skeleton) {
                    layerSkeletons[sdi]._savedSkX = layerSkeletons[sdi].skeleton.x;
                    layerSkeletons[sdi]._savedSkY = layerSkeletons[sdi].skeleton.y;
                }
                break;
            }
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
    }
};

/** 加载单个节点的骨架到指定的 GL 上下文，返回骨架渲染数据 */
SMTool._loadOneSkeletonToGL = function (gl, SP, WGL, srcNode, physParam, cw, ch, useVer) {
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

    // 解析 skeleton
    var al = new SP.AtlasAttachmentLoader(atlas);
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
    var skelW = bs.x || 1, skelH = bs.y || 1;
    var centerX = bo.x + skelW / 2, centerY = bo.y + skelH / 2;
    // 与单节点预览一致的居中
    sk.x = cw / 2 - centerX;
    sk.y = ch / 2 - centerY;
    // 保存边界信息，统一缩放由 _showLayerPreview / _syncLayerPreviewViewport 计算
    var aspectInfo = { centerX: centerX, centerY: centerY, skelW: skelW, skelH: skelH };

    // WebGL 纹理
    var glTextures = [];
    if (useVer === '4.3' || useVer === '4.2') {
        var mc = new SP.ManagedWebGLRenderingContext(gl.canvas, { alpha: true });
        for (var ti = 0; ti < atlas.pages.length; ti++) {
            var pi2 = (imgs && ti < imgs.length) ? imgs[ti] : imgs[0];
            var glTex2 = new SP.GLTexture(mc, pi2, atlas.pages[ti].pma || false);
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
    if (animName) {
        state.setAnimation(0, animName, srcNode.loop !== false);
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

    return {
        skeleton: sk,
        state: state,
        physParam: physParam,
        premultipliedAlpha: srcNode.premultipliedAlpha || false,
        useVer: useVer,
        shader: shader,
        batcher: batcher,
        mvp: mvp,
        skeletonRenderer: skRenderer,
        glTextures: glTextures,
        aspectInfo: aspectInfo  // ★ 等比例参数
    };
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

/** ★ 渲染多层骨架到预览画布 — 先清屏(透明)，从底向上逐层绘制 */
SMTool._renderLayerPreview = function (layerNode, pp, now) {
    var list = pp._layerSkeletons; if (!list || list.length === 0) return;
    var gl = pp.gl, canvas = pp.canvas; if (!gl || !canvas) return;
    var WGL = window.spine38 && window.spine38.webgl; if (!WGL || !WGL.Shader) return;

    // ★ 收集本帧正在播放 + 全部参与的动画节点 ID，及播放进度
    var activeNodeIds = new Set();
    var allChainNodeIds = new Set();
    var activeNodeProgress = {};  // { nodeId: 0.0~1.0 } 播放进度比例

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // ★ 启动延迟帧（含重建后安全帧）：清屏不渲染
    if (pp._startupDelayFrames > 0) {
        pp._startupDelayFrames--;
        pp._lastTime = now;
        return;
    }

    var dt = Math.min((now - (pp._lastTime || now)) / 1000, 0.1);
    pp._lastTime = now;

    for (var i = list.length - 1; i >= 0; i--) {
        var ls = list[i];
        // ★ 跳过隐藏的层
        if (ls._hidden) continue;
        // ★ 动画链播放：每次只更新链上当前活跃的骨架
        if (ls._chainSkeletons && ls._chainSkeletons.length > 0) {
            var chainLen = ls._chainSkeletons.length;
            var curIdx = ls._chainIdx || 0;
            var active = ls._chainSkeletons[curIdx];
            var shouldAdvance = false;
            // ★ 已完成层冻结：不再更新动画，保持最后一帧画面不动，等待栅栏同步
            if (ls._chainDone) {
                // 不更新动画状态，下方仍会渲染 ls.skeleton（最后一帧定格）
            }
            // ★ 延时器节点：累积等待时间
            else if (active && active._isDelayer && !pp._flowFrozen) {
                if (ls._delayElapsed === undefined) ls._delayElapsed = 0;
                ls._delayElapsed += dt;
                // 延时器期间保持上一帧的骨架渲染（ls.skeleton 等沿用上次赋值）
                if (ls._delayElapsed >= (active._delayValue || 1.0)) {
                    shouldAdvance = true;
                    ls._delayElapsed = 0;
                }
            }
            // ★ Spine 动画节点：正常播放（根据循环模式判断推进时机）
            else if (active && active.state && !pp._flowFrozen) {
                ls._delayElapsed = 0;
                // ★ 从链骨架对应的源节点读取播放倍速和循环模式
                var chainSpd = 1.0;
                var chainSrc = null;
                if (active._chainNodeId != null) {
                    chainSrc = SMData.nodes.get(active._chainNodeId);
                    if (chainSrc && typeof chainSrc._playbackSpeed === 'number') chainSpd = chainSrc._playbackSpeed;
                }
                active.state.update(dt * chainSpd);
                active.state.apply(active.skeleton);
                active.skeleton.updateWorldTransform(active.physParam);
                var entry = active.state.getCurrent(0);
                if (entry) {
                    var anim = entry.animation || entry._animation;
                    if (anim) {
                        var animDur = anim.duration || 1;
                        var loopMode = (chainSrc && chainSrc.loop !== false) ? (chainSrc._loopMode || null) : null;
                        if (!ls._loopTrack) ls._loopTrack = { currentLoop: 0, totalElapsed: 0 };
                        if (loopMode === 'time') {
                            // 循环时间模式：累计总流逝时间
                            ls._loopTrack.totalElapsed += dt * chainSpd;
                            var loopTime = chainSrc._loopTime;
                            if (loopTime === undefined || loopTime === null) loopTime = animDur / Math.abs(chainSpd || 1);
                            if (ls._loopTrack.totalElapsed >= loopTime) {
                                shouldAdvance = true;
                            }
                        } else if (loopMode === 'count') {
                            // 循环次数模式：追踪完成的循环次数
                            var curLoop = Math.floor(entry.trackTime / animDur);
                            if (curLoop > ls._loopTrack.currentLoop) {
                                ls._loopTrack.currentLoop = curLoop;
                            }
                            var loopCount = (chainSrc._loopCount !== undefined) ? chainSrc._loopCount : 1;
                            if (loopCount === -1) {
                                shouldAdvance = false; // 无限循环，永不推进
                            } else if (curLoop >= loopCount) {
                                shouldAdvance = true;
                            }
                        } else {
                            // 默认：动画播完就推进（单次播放）
                            if (entry.trackTime >= animDur - 0.001) {
                                shouldAdvance = true;
                            }
                        }
                    }
                }
            }
            // ★ 切换到链上下一个（或停在末尾等待栅栏同步）
            if (shouldAdvance) {
                if (curIdx >= chainLen - 1) {
                    // ★ 已是链上最后一个动画 → 标记此层完成，停在最后一帧不动
                    ls._chainDone = true;
                } else {
                    ls._chainIdx = curIdx + 1;
                    ls._delayElapsed = 0;
                    var next = ls._chainSkeletons[ls._chainIdx];
                    // 下一个是 Spine 节点：重置动画
                    if (next && !next._isDelayer && next.state) {
                        try { next.state.clearTracks(); } catch (e) {}
                        var nextAnim = (next._chainAnimName || (next.stateData && next.stateData.skeletonData && next.stateData.skeletonData.animations && next.stateData.skeletonData.animations[0] && next.stateData.skeletonData.animations[0].name) || '');
                        if (nextAnim) {
                            next.state.setAnimation(0, nextAnim, false);
                            next.state.update(0);
                            next.state.apply(next.skeleton);
                        }
                        // ★ 立即刷新新骨架的世界变换（否则本帧骨图渲染会读到居中默认位置）
                        next.skeleton.updateWorldTransform(next.physParam);
                    }
                }
            }
            // ★ 将活跃骨架引用同步到 ls 以便下方渲染（延时器节点无骨架，保留上次渲染的骨架）
            if (active && !active._isDelayer) {
                ls.skeleton = active.skeleton;
                ls.state = active.state;
                ls.shader = active.shader;
                ls.batcher = active.batcher;
                ls.skeletonRenderer = active.skeletonRenderer;
                ls.physParam = active.physParam;
                ls.mvp = active.mvp;
                ls.premultipliedAlpha = active.premultipliedAlpha || false;
            }
            // ★ 延时器节点：不更新骨架引用，沿用上一帧的渲染数据（画面定格）
        }

        if (!ls.skeleton || !ls.state || !ls.shader || !ls.batcher || !ls.skeletonRenderer) {
            // ★ 延时器直连且链中无动画骨架时，跳过渲染但不影响链时间推进
            if (ls._chainSkeletons && ls._chainSkeletons.length > 1) {
                // 链中有后续元素，当前元素缺少渲染资源 → 正常情况，跳过渲染
            }
            continue;
        }
        // 动画已在链逻辑中更新，此处不再重复调用 state.update
        if (!ls._chainSkeletons && !pp._flowFrozen) {
            ls.state.update(dt);
            ls.state.apply(ls.skeleton);
        }
        ls.skeleton.updateWorldTransform(ls.physParam);
        // 每层前清 stencil（Spine 裁剪依赖）
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        ls.shader.bind();
        ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
        ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);
        ls.batcher.begin(ls.shader);
        ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
        ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
        ls.batcher.end();
        ls.shader.unbind();

        // ★ 收集当前活跃骨架对应的源节点 ID，用于主画布高亮
        // ★ 注意：_chainDone 的层不应标记为活跃（主画布动画节点应停止在最后一帧）
        var activeEntry = ls._chainSkeletons ? ls._chainSkeletons[ls._chainIdx || 0] : ls;
        var nid = activeEntry._chainNodeId || activeEntry.nodeId;
        if (nid != null && !ls._chainDone) {
            activeNodeIds.add(nid);
        }
        // ★ 计算播放进度比例（延时器用已等待时间/总延迟，动画用 trackTime/duration）
        if (nid != null) {
            if (ls._chainDone) {
                // 已完成层：进度固定为 100%，不再更新动画
                activeNodeProgress[nid] = 1.0;
            } else if (activeEntry._isDelayer) {
                var delProg = (ls._delayElapsed || 0) / Math.max((activeEntry._delayValue || 1), 0.001);
                activeNodeProgress[nid] = Math.min(1, delProg);
            } else if (activeEntry.state) {
                var te = activeEntry.state.getCurrent(0);
                if (te) {
                    var animDur = (te.animation || te._animation || {}).duration || 1;
                    // ★ 根据源节点的循环模式计算总进度比例
                    var chainSrcProg = (activeEntry._chainNodeId != null) ? SMData.nodes.get(activeEntry._chainNodeId) : null;
                    var loopModeProg = (chainSrcProg && chainSrcProg.loop !== false) ? (chainSrcProg._loopMode || null) : null;
                    if (loopModeProg === 'time') {
                        // 循环时间：总流逝时间 / 设定时间
                        var totalTime = chainSrcProg._loopTime;
                        if (!totalTime) totalTime = animDur / Math.abs(chainSrcProg._playbackSpeed || 1);
                        activeNodeProgress[nid] = Math.min(1, (ls._loopTrack ? ls._loopTrack.totalElapsed : 0) / Math.max(totalTime, 0.001));
                    } else if (loopModeProg === 'count') {
                        // 循环次数：(已完成循环数×时长 + 当前循环内时间) / (总循环数×时长)
                        var totalLoops = (chainSrcProg._loopCount !== undefined && chainSrcProg._loopCount !== -1) ? chainSrcProg._loopCount : 1;
                        var curLoop = ls._loopTrack ? ls._loopTrack.currentLoop : 0;
                        var trackInLoop = te.trackTime - curLoop * animDur;
                        if (trackInLoop < 0) trackInLoop = 0;
                        if (trackInLoop > animDur) trackInLoop = animDur;
                        var totalProgress = (curLoop * animDur + trackInLoop) / (totalLoops * animDur);
                        activeNodeProgress[nid] = Math.min(1, Math.max(0, totalProgress));
                    } else {
                        // 默认单次：当前时间 / 单次时长
                        activeNodeProgress[nid] = Math.min(1, te.trackTime / Math.max(animDur, 0.001));
                    }
                }
            }
        }
        // ★ 收集该层所有链骨架的节点 ID（用于非活跃节点置灰）
        if (ls._chainSkeletons) {
            for (var csi = 0; csi < ls._chainSkeletons.length; csi++) {
                var cid = ls._chainSkeletons[csi]._chainNodeId;
                if (cid != null) allChainNodeIds.add(cid);
            }
        } else if (ls.nodeId != null) {
            allChainNodeIds.add(ls.nodeId);
        }
    }

    // ★ 同步主画布节点高亮 + 进度条：活跃节点粉色发光+进度条，非活跃链节点置灰
    SMTool._updateLayerPlayingHighlights(activeNodeIds, allChainNodeIds, activeNodeProgress);

    // ★★★ 栅栏同步：检查所有层是否都已完成 ★★★
    // 设旗标 → 6帧清屏 → _showLayerPreview重建 → 1帧安全延迟 → 渲染新周期
    if (!pp._flowFrozen && list.length > 0) {
        var allDone = true;
        for (var j = 0; j < list.length; j++) {
            if (!list[j]._chainDone) { allDone = false; break; }
        }
        if (allDone) {
            for (var k = 0; k < list.length; k++) {
                list[k]._chainDone = false;
                list[k]._chainIdx = 0;
                list[k]._delayElapsed = 0;
            }
            pp._startupDelayFrames = 6;
            pp._needsLayerRebuild = true;
            pp._needsLayerReinit = true;
            gl.clearColor(0, 0, 0, 0);
            gl.clearStencil(0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
            gl.flush();
        }
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
                }
            } else if (ls.mvp) {
                ls.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
            }
        }
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
};

console.log('[LayerNode] 已加载');

// ================================================================
// ★ 测试：直接取画布上前两个动画节点，叠加渲染到浮窗
// ================================================================
SMTool._testLayerPreviewDirect = function () {
    // 找不同源文件的 spine 节点
    var spineNodes = [];
    var iter = SMData.nodes.values(), r = iter.next();
    while (!r.done) {
        if (r.value.nodeType === 'spine' && (r.value.textureImg || (r.value._texImgs && r.value._texImgs.length > 0)) &&
            r.value._srcAtlasText && (r.value._srcSkelJson || r.value._srcSkelBinBase64)) {
            spineNodes.push(r.value);
        }
        r = iter.next();
    }

    // 找两个不同源文件的节点
    var nodeA = null, nodeB = null;
    for (var i = 0; i < spineNodes.length; i++) {
        if (!nodeA) { nodeA = spineNodes[i]; continue; }
        if (spineNodes[i].sourceFile !== nodeA.sourceFile) { nodeB = spineNodes[i]; break; }
    }

    if (!nodeA || !nodeB) {
        var msg = '需要 2 个**不同动画文件**的节点！\n';
        msg += '当前共 ' + spineNodes.length + ' 个动画节点';
        if (nodeA && !nodeB) msg += '，但全部是同一个文件：' + (nodeA.sourceFile || '未知');
        msg += '\n\n请拖入第二个不同的动画文件。';
        alert(msg);
        return;
    }

    var pp = SMData._animPreview;
    var panel = document.getElementById('animPreviewPanel');
    var canvas = document.getElementById('appCanvas');
    if (!panel || !canvas) return;

    SMTool._destroyAnimPreview();
    panel.style.display = 'flex';
    pp.visible = true;
    pp.nodeId = -1; // 测试模式

    // 仅 3.8
    var SP = window.spine38; if (!SP) { alert('Spine 3.8 未加载'); return; }
    var WGL = SP.webgl; if (!WGL || !WGL.Shader) { alert('WGL 未就绪'); return; }
    pp._spineVer = '3.8';

    var cw = pp.panelW || 385, ch = pp.panelH || 645;
    canvas.width = cw; canvas.height = ch;
    pp.canvas = canvas; pp._canvasWidth = cw; pp._canvasHeight = ch;

    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });
    if (!gl) { alert('WebGL 不可用'); return; }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    pp.gl = gl;

    function loadOne(srcNode) {
        var atlas = new SP.TextureAtlas(srcNode._srcAtlasText, function () { return new SP.FakeTexture(srcNode._texImgs[0]); });
        var al = new SP.AtlasAttachmentLoader(atlas);
        var sd = (srcNode._srcType === 'skel' && srcNode._srcSkelBinBase64)
            ? new SP.SkeletonBinary(al).readSkeletonData(SMTool._base64ToUint8(srcNode._srcSkelBinBase64))
            : new SP.SkeletonJson(al).readSkeletonData(srcNode._srcSkelJson);
        if (!sd) return null;

        var sk = new SP.Skeleton(sd);
        var sn = srcNode.currentSkin;
        if (sn) { for (var i = 0; i < sd.skins.length; i++) { if (sd.skins[i].name === sn) { sk.setSkin(sd.skins[i]); break; } } }
        else if (sd.defaultSkin) sk.setSkin(sd.defaultSkin);
        sk.setToSetupPose();

        var bo = new SP.Vector2(), bs = new SP.Vector2();
        try { if (typeof sk.getBounds === 'function') sk.getBounds(bo, bs, []); } catch(e) {}
        sk.x = cw / 2 - (bo.x + bs.x / 2); sk.y = ch / 2 - (bo.y + bs.y / 2);
        sk.updateWorldTransform();

        for (var ti = 0; ti < atlas.pages.length; ti++) {
            var pi = (srcNode._texImgs && ti < srcNode._texImgs.length) ? srcNode._texImgs[ti] : srcNode._texImgs[0];
            atlas.pages[ti].texture = new WGL.GLTexture(gl, pi, false);
        }
        for (var ri = 0; ri < atlas.regions.length; ri++) {
            if (atlas.regions[ri].page && atlas.regions[ri].page.texture) atlas.regions[ri].texture = atlas.regions[ri].page.texture;
        }

        var sd2 = new SP.AnimationStateData(sd);
        var st = new SP.AnimationState(sd2);
        var an = srcNode.currentAnim || (srcNode.animations[0] && srcNode.animations[0].name) || '';
        if (an) { st.setAnimation(0, an, srcNode.loop !== false); st.update(0); st.apply(sk); }
        sk.updateWorldTransform();

        var sh = WGL.Shader.newTwoColoredTextured(gl);
        var ba = new WGL.PolygonBatcher(gl);
        var mv = new WGL.Matrix4(); mv.ortho2d(0, 0, cw - 1, ch - 1);
        var sr = new WGL.SkeletonRenderer(gl);

        return { skeleton: sk, state: st, shader: sh, batcher: ba, mvp: mv, skeletonRenderer: sr, pma: srcNode.premultipliedAlpha || false };
    }

    var layerA = loadOne(nodeA);
    var layerB = loadOne(nodeB);

    if (!layerA || !layerB) {
        alert('骨架加载失败: A=' + !!layerA + ' B=' + !!layerB);
        if (gl) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
        panel.style.display = 'none'; pp.visible = false;
        return;
    }

    pp._layerSkeletons = [
        { layer: 1, skeleton: layerA.skeleton, state: layerA.state, shader: layerA.shader, batcher: layerA.batcher, mvp: layerA.mvp, skeletonRenderer: layerA.skeletonRenderer, pma: layerA.pma, physParam: undefined, premultipliedAlpha: layerA.pma },
        { layer: 2, skeleton: layerB.skeleton, state: layerB.state, shader: layerB.shader, batcher: layerB.batcher, mvp: layerB.mvp, skeletonRenderer: layerB.skeletonRenderer, pma: layerB.pma, physParam: undefined, premultipliedAlpha: layerB.pma }
    ];
    pp.skeleton = null; pp.state = null;
    pp._readyToRender = true; pp._lastTime = performance.now(); pp.visible = true;

    var title = document.getElementById('appTitle');
    if (title) title.textContent = '🧪 L1(上):' + (nodeA.sourceFile || 'A') + ' + L2(下):' + (nodeB.sourceFile || 'B');
    var srcEl2 = document.getElementById('appSourceFile');
    if (srcEl2) srcEl2.textContent = '';

    alert('✅ 测试就绪！\n\nL1 上层: ' + (nodeA.sourceFile || '节点A') + '\nL2 下层: ' + (nodeB.sourceFile || '节点B') + '\n\n浮窗里应该看到两个不同的动画叠加。');
};

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

// ★ 构建层级列表内容
SMTool._buildLayerList = function () {
    var content = document.getElementById('allListContent');
    if (!content) return;
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons) { content.innerHTML = '<div style="padding:12px;color:var(--text2);font-size:12px">无层级数据</div>'; return; }

    var html = '';
    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        var ls = pp._layerSkeletons[i];
        var layerNum = ls.layer || (i + 1);
        var fileName = '';
        // 从链首骨架获取源文件名
        if (ls._chainSkeletons && ls._chainSkeletons.length > 0) {
            var first = ls._chainSkeletons[0];
            var srcNode = SMData.nodes.get(first._chainNodeId || ls.nodeId);
            if (srcNode && srcNode.sourceFile) fileName = srcNode.sourceFile;
        }
        if (!fileName && ls.nodeId != null) {
            var sn = SMData.nodes.get(ls.nodeId);
            if (sn && sn.sourceFile) fileName = sn.sourceFile;
        }
        fileName = fileName || ('层' + layerNum);

        var isHidden = ls._hidden;
        var isPosActive = ls._positionDragActive;
        html += '<div class="all-item' + (isHidden ? ' hidden-layer' : '') + '">' +
            '<div class="all-item-row1">' +
                '<span class="all-item-layer">L' + layerNum + '</span>' +
                '<span class="all-item-file" title="' + SMTool._esc(fileName) + '">' + SMTool._esc(fileName) + '</span>' +
            '</div>' +
            '<div class="all-item-row2">' +
                '<button class="all-btn' + (isHidden ? '' : ' active') + '" onclick="SMTool._toggleLayerVisibility(' + i + ')" title="' + (isHidden ? '显示' : '隐藏') + '层级">👁</button>' +
                '<button class="all-btn' + (isPosActive ? ' active' : '') + '" id="allPosBtn-' + i + '" onclick="SMTool._toggleLayerPositionDrag(' + i + ')" title="拖拽移动层级位置">📍</button>' +
            '</div>' +
            '<div class="all-pos-actions' + (isPosActive ? ' show' : '') + '" id="allPosActions-' + i + '">' +
                '<button class="pos-ok" onclick="SMTool._confirmLayerPosition(' + i + ')">✓ 确定</button>' +
                '<button class="pos-cancel" onclick="SMTool._cancelLayerPosition(' + i + ')">✗ 取消</button>' +
                '<button class="pos-reset" onclick="SMTool._resetLayerPosition(' + i + ')">↺ 默认</button>' +
            '</div>' +
        '</div>';
    }
    content.innerHTML = html;
};

// ★ 切换层级显隐
SMTool._toggleLayerVisibility = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];
    ls._hidden = !ls._hidden;
    SMTool._buildLayerList();
};

// ★ 切换层级位置拖拽模式
SMTool._toggleLayerPositionDrag = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];
    // 关闭其他层的拖拽模式
    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        if (i !== idx) pp._layerSkeletons[i]._positionDragActive = false;
    }
    ls._positionDragActive = !ls._positionDragActive;
    if (ls._positionDragActive) {
        // 进入拖拽模式：保存当前位置
        if (ls.skeleton) {
            ls._savedSkX = ls.skeleton.x;
            ls._savedSkY = ls.skeleton.y;
        }
        pp._layerDragTargetIdx = idx;
    } else {
        pp._layerDragTargetIdx = -1;
    }
    SMTool._buildLayerList();
};

// ★ 确定位置（保存该层所有链骨架的偏移量）
SMTool._confirmLayerPosition = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];

    // ★ 为该层每个链骨架保存相对于默认居中位置的偏移量
    var layerNode = SMData.nodes.get(pp.nodeId);
    if (layerNode && layerNode._layerData && ls.layer) {
        var ld = layerNode._layerData;
        if (!ld.layers[ls.layer]) ld.layers[ls.layer] = {};
        // 清空旧偏移数据
        ld.layers[ls.layer]._chainPositions = {};
        var chain = ls._chainSkeletons || [ls];
        for (var ci = 0; ci < chain.length; ci++) {
            var csk = chain[ci];
            if (csk.skeleton && csk._chainNodeId != null) {
                var defX = csk._defaultSkX !== undefined ? csk._defaultSkX : csk.skeleton.x;
                var defY = csk._defaultSkY !== undefined ? csk._defaultSkY : csk.skeleton.y;
                ld.layers[ls.layer]._chainPositions[csk._chainNodeId] = {
                    offX: csk.skeleton.x - defX,
                    offY: csk.skeleton.y - defY
                };
            }
        }
    }
    ls._positionDragActive = false;
    pp._layerDragTargetIdx = -1;
    SMTool._buildLayerList();
};

// ★ 取消位置（恢复该层所有链骨架到拖拽前的位置）
SMTool._cancelLayerPosition = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];
    var positions = pp._layerDragStartPositions;
    if (positions) {
        for (var pi = 0; pi < positions.length; pi++) {
            positions[pi].sk.x = positions[pi].x;
            positions[pi].sk.y = positions[pi].y;
        }
    }
    ls._positionDragActive = false;
    pp._layerDragTargetIdx = -1;
    SMTool._buildLayerList();
};

// ★ 恢复默认位置（清除该层所有链骨架的偏移）
SMTool._resetLayerPosition = function (idx) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerSkeletons || idx >= pp._layerSkeletons.length) return;
    var ls = pp._layerSkeletons[idx];
    // 恢复所有链骨架到默认居中位置
    var chain = ls._chainSkeletons || [ls];
    for (var ci = 0; ci < chain.length; ci++) {
        var csk = chain[ci];
        if (csk.skeleton && csk._defaultSkX !== undefined) {
            csk.skeleton.x = csk._defaultSkX;
            csk.skeleton.y = csk._defaultSkY;
        }
    }
    // ★ 清除工程中保存的偏移
    var layerNode = SMData.nodes.get(pp.nodeId);
    if (layerNode && layerNode._layerData && ls.layer) {
        var ld = layerNode._layerData;
        if (ld.layers[ls.layer]) {
            delete ld.layers[ls.layer]._chainPositions;
            delete ld.layers[ls.layer].posOffX;
            delete ld.layers[ls.layer].posOffY;
            delete ld.layers[ls.layer].posX;
            delete ld.layers[ls.layer].posY;
        }
    }
    SMTool._buildLayerList();
};

// ★ 鼠标按下：开始拖拽层级位置（保存该层所有链骨架的起始位置）
SMTool._onLayerPosMouseDown = function (e) {
    var pp = SMData._animPreview;
    if (!pp || pp._layerDragTargetIdx < 0 || !pp._layerSkeletons) return;
    var ls = pp._layerSkeletons[pp._layerDragTargetIdx];
    if (!ls || !ls._positionDragActive || !ls.skeleton) return;

    var canvas = pp.canvas || document.getElementById('appCanvas');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

    e.preventDefault();
    pp._layerDragActive = true;
    pp._layerDragStartX = e.clientX;
    pp._layerDragStartY = e.clientY;
    // ★ 保存该层所有链骨架的起始位置（直接+间接动画节点一起移动）
    pp._layerDragStartPositions = [];
    var chain = ls._chainSkeletons || [ls];
    for (var ci = 0; ci < chain.length; ci++) {
        if (chain[ci].skeleton) {
            pp._layerDragStartPositions.push({ sk: chain[ci].skeleton, x: chain[ci].skeleton.x, y: chain[ci].skeleton.y });
        }
    }
};

// ★ 鼠标移动：拖拽层级位置（该层所有链骨架同步移动）
SMTool._onLayerPosMouseMove = function (e) {
    var pp = SMData._animPreview;
    if (!pp || !pp._layerDragActive || pp._layerDragTargetIdx < 0) return;
    var ls = pp._layerSkeletons[pp._layerDragTargetIdx];
    if (!ls) return;

    var zoom = pp._contentZoom || 1.0;
    var dx = (e.clientX - pp._layerDragStartX) / zoom;
    var dy = (e.clientY - pp._layerDragStartY) / zoom;
    // ★ 将该层所有链骨架移动相同的位移量
    var positions = pp._layerDragStartPositions;
    if (positions) {
        for (var pi = 0; pi < positions.length; pi++) {
            positions[pi].sk.x = positions[pi].x + dx;
            positions[pi].sk.y = positions[pi].y - dy;
        }
    }
};

// ★ 鼠标释放：结束拖拽
SMTool._onLayerPosMouseUp = function () {
    var pp = SMData._animPreview;
    if (!pp) return;
    pp._layerDragActive = false;
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
};

console.log('[LayerNode] 层级节点模块已加载');
