/* ================================================================
   layer-node.js — 层级节点模块（完全分离，不影响旧代码逻辑）
   功能：叠加多层动画骨架，层数决定显示优先级，
   数越小越靠上。独占式右侧端点（每层一个），
   每个端点仅可连一根线，新连线替换旧连线。
   浮窗预览叠加渲染，动画流并行分支播放。
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
        ev.stopPropagation();
        ev.preventDefault();
        var cur = document.getElementById('sn-' + dragNode.id);
        if (cur) {
            var rows = cur.querySelectorAll('.layer-box-row');
            var target = null;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i].getBoundingClientRect();
                if (ev.clientY >= r.top && ev.clientY <= r.bottom) { target = rows[i]; break; }
            }
            if (target) {
                var tgtNum = parseInt(target.getAttribute('data-layer'));
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
    console.log('[layerSwap] layerCount=', lc, 'layers=', JSON.stringify(ld.layers));
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
    console.log('[layerSwap] orderedData before:', JSON.stringify(orderedData), 'conns:', JSON.stringify(orderedConns));

    var movedData = orderedData[srcLayer - 1];
    var movedConn = orderedConns[srcLayer - 1];
    orderedData.splice(srcLayer - 1, 1);
    orderedConns.splice(srcLayer - 1, 1);
    var insertIdx = tgtLayer - 1;
    if (insertIdx < 0) insertIdx = 0;
    if (insertIdx > orderedData.length) insertIdx = orderedData.length;
    orderedData.splice(insertIdx, 0, movedData);
    orderedConns.splice(insertIdx, 0, movedConn);
    console.log('[layerSwap] orderedData after:', JSON.stringify(orderedData));

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
};

/** ★ 若浮窗正在显示该层级节点，立即刷新 */
SMTool._refreshLayerPreviewIfOpen = function (layerNode) {
    var pp = SMData._animPreview;
    if (pp && pp.visible && pp.nodeId === layerNode.id && pp._layerSkeletons && pp._layerSkeletons.length > 0) {
        SMTool._showLayerPreview(layerNode);
    }
};

/** ▲▼ 按钮移动层：dir=-1 上移，dir=1 下移 */
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
        // 兜底1：_layerNum 标记
        var ln = (c._layerNum >= 1 && c._layerNum <= ld.layerCount) ? c._layerNum : 0;
        // 兜底2：从 fromState 解析层号（兼容无 _layerNum 的旧连线）
        if (!ln && typeof c.fromState === 'string' && c.fromState.indexOf('layer_') === 0) {
            ln = parseInt(c.fromState.replace('layer_', '')) || 0;
        }
        if (ln >= 1 && ln <= ld.layerCount) {
            var tn = SMData.nodes.get(c.toNode);
            if (tn && tn.nodeType === 'spine' && tn._srcAtlasText && (tn._srcSkelJson || tn._srcSkelBinBase64) && tn._texImgs && tn._texImgs.length > 0) {
                var dup = false;
                for (var dj = 0; dj < linkedNodes.length; dj++) {
                    if (linkedNodes[dj].layer === ln) { dup = true; break; }
                }
                if (!dup) linkedNodes.push({ layer: ln, node: tn });
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
                if (ln2 && ln2.nodeType === 'spine' && ln2._srcAtlasText && (ln2._srcSkelJson || ln2._srcSkelBinBase64) && ln2._texImgs && ln2._texImgs.length > 0) {
                    linkedNodes.push({ layer: li, node: ln2 });
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
        return;
    }

    // 销毁旧预览
    SMTool._destroyAnimPreview();
    panel.style.display = 'flex';
    pp.visible = true;
    pp.nodeId = layerNode.id;

    // 确定 Spine 版本
    var firstNode = linkedNodes[0].node;
    var ver = firstNode.version || firstNode._spineVer || '';
    var useVer = SMTool._resolveRuntimeVersion(ver, null, false);
    var SP = SMTool._getSpineRuntime(useVer);

    // 设置画布 — 取 canvas 容器实际尺寸（排除标题栏），与单节点预览一致
    var savedW = pp.panelW || 320;
    var savedH = pp.panelH || 500;
    panel.style.width = savedW + 'px';
    panel.style.height = savedH + 'px';
    var wrap = canvas.parentElement;
    var cw = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : savedW;
    var ch = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : savedH;
    if (cw < 10) cw = savedW;
    if (ch < 10) ch = savedH;
    canvas.width = cw;
    canvas.height = ch;
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

    // ★ 统一加载所有层
    var layerSkeletons = [];
    for (var lj = 0; lj < linkedNodes.length; lj++) {
        var item = linkedNodes[lj];
        var ls = SMTool._loadOneSkeletonToGL(gl, SP, WGL, item.node, physParam, cw, ch, useVer);
        if (ls) {
            ls.layer = item.layer;
            ls.nodeId = item.node.id;
            layerSkeletons.push(ls);
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
    // ★ 用统一 zoom 直接覆写所有层的初始 MVP（不再依赖 _syncLayerPreviewViewport 二次修正）
    for (var li2 = 0; li2 < layerSkeletons.length; li2++) {
        var lsi = layerSkeletons[li2];
        if (lsi.mvp && lsi.aspectInfo) {
            var ai2 = lsi.aspectInfo;
            lsi.skeleton.x = cw / 2 - ai2.centerX;
            lsi.skeleton.y = ch / 2 - ai2.centerY;
            lsi.mvp.ortho2d(cw / 2 - cw / (2 * savedZoom), ch / 2 - ch / (2 * savedZoom), cw / savedZoom, ch / savedZoom);
        }
    }
    SMTool._updateAnimPreviewZoomLabel(savedZoom);

    pp._layerSkeletons = layerSkeletons;
    pp.skeleton = null;
    pp.state = null;
    pp._readyToRender = true;
    pp._lastTime = performance.now();
    pp.visible = true;

    var title = document.getElementById('appTitle');
    if (title) title.textContent = '📚 层级 (' + layerSkeletons.length + '/' + ld.layerCount + '层就绪)';

    // ★ 诊断：若全部加载失败，标题显示错误
    if (layerSkeletons.length === 0 && linkedNodes.length > 0) {
        if (title) title.textContent = '⚠ 层级加载失败(贴图/版本?)';
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

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    var dt = Math.min((now - (pp._lastTime || now)) / 1000, 0.1);
    pp._lastTime = now;

    for (var i = list.length - 1; i >= 0; i--) {
        var ls = list[i];
        if (!ls.skeleton || !ls.state || !ls.shader || !ls.batcher || !ls.skeletonRenderer) continue;
        if (!pp._flowFrozen) ls.state.update(dt);
        ls.state.apply(ls.skeleton);
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
    }
};

/** 同步层级预览缩放 — 用标准 ortho 公式（与单节点一致）+ 统一 zoom */
SMTool._syncLayerPreviewViewport = function (pp, newW, newH) {
    if (!pp._layerSkeletons) return;
    var canvas = pp.canvas;
    var wrap = canvas ? canvas.parentElement : null;
    var cw = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : (newW || pp._canvasWidth || pp.panelW || 320);
    var ch = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : (newH || pp._canvasHeight || pp.panelH || 500);
    if (canvas) { canvas.width = cw; canvas.height = ch; }
    pp._canvasWidth = cw;
    pp._canvasHeight = ch;
    
    var zoom = pp._contentZoom || 1.0;
    // ★ 重新居中每层骨架 + 更新 ortho
    for (var i = 0; i < pp._layerSkeletons.length; i++) {
        var ls = pp._layerSkeletons[i];
        if (!ls.skeleton) continue;
        var ai = ls.aspectInfo;
        if (ai) {
            ls.skeleton.x = cw / 2 - ai.centerX;
            ls.skeleton.y = ch / 2 - ai.centerY;
        }
        if (ls.mvp) {
            ls.mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
        }
    }
    SMTool._updateAnimPreviewZoomLabel(zoom);
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
        if (r.value.nodeType === 'spine' && r.value._texImgs && r.value._texImgs.length > 0 &&
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

    var cw = pp.panelW || 320, ch = pp.panelH || 500;
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

    alert('✅ 测试就绪！\n\nL1 上层: ' + (nodeA.sourceFile || '节点A') + '\nL2 下层: ' + (nodeB.sourceFile || '节点B') + '\n\n浮窗里应该看到两个不同的动画叠加。');
};

console.log('[LayerNode] 层级节点模块已加载');
