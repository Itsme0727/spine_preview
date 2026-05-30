/* ================================================================
   交互事件 — 鼠标、键盘、拖拽处理
   负责: 所有用户交互（点击选中、拖拽移动、连线、条件编辑）
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 鼠标按下 ----
SMTool._onMD = function (e) {
    // 优先检测控制点点击
    if (e.button === 0 && !e.altKey) {
        var cp = SMTool._findCP(e.clientX, e.clientY, 14);
        if (cp) {
            SMData.draggingCP = cp;
            SMData.selectingCP = true;
            SMTool.gridCanvas.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }

    // 中键/右键/Alt+左键 → 平移
    if (e.button === 2) {
        SMTool._onPanStart(e);
        SMTool.gridCanvas.style.cursor = 'grabbing';
        return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        SMTool._onPanStart(e);
        SMTool.gridCanvas.style.cursor = 'grabbing';
        return;
    }

    // 左键
    if (e.button === 0) {
        // 检测条件标签点击
        if (SMTool._checkConditionClick(e.clientX, e.clientY)) return;

        // 检测节点点击
        var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
        var found = null;
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        while (!result.done) {
            if (SMTool._hitTest(result.value, wp.x, wp.y)) { found = result.value; break; }
            result = nodesIter.next();
        }

        if (found) {
            SMData.selectedNode = found.id;
            SMData.selectedConnection = null;
            SMData.draggedNode = found;
            SMTool._updateStateRowColors();
            SMData.dragOffset = { x: wp.x - found.x, y: wp.y - found.y };
            SMTool._updateSel();
        } else {
            // 点击空白：取消所有选中
            SMData.selectedNode = null;
            SMData.selectedConnection = null;
            SMData.draggedNode = null;
            SMTool._updateStateRowColors();
            SMTool._updateSel();
        }
    }
};

// ---- 鼠标移动 ----
SMTool._onMM = function (e) {
    SMData._mx = e.clientX;
    SMData._my = e.clientY;

    // 连线模式
    if (SMData.connecting) {
        SMData.connecting.mx = e.clientX;
        SMData.connecting.my = e.clientY;
        SMTool._highlightTarget(e.clientX, e.clientY);
    }

    // 拖拽控制点
    if (SMData.draggingCP) {
        var conn = null;
        for (var i = 0; i < SMData.connections.length; i++) {
            if (SMData.connections[i].id === SMData.draggingCP.connId) {
                conn = SMData.connections[i];
                break;
            }
        }
        if (conn) {
            var fn = SMData.nodes.get(conn.fromNode);
            var tn = SMData.nodes.get(conn.toNode);
            if (fn && tn) {
                var fp = SMTool._getStateConnectorPos(fn, conn.fromState, 'output');
                var tp = SMTool._getStateConnectorPos(tn, conn.toState, 'input');
                var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
                if (SMData.draggingCP.which === 'cp1' && fp) {
                    conn.cp1x = wp.x - fp.x;
                    conn.cp1y = wp.y - fp.y;
                } else if (SMData.draggingCP.which === 'cp2' && tp) {
                    conn.cp2x = wp.x - tp.x;
                    conn.cp2y = wp.y - tp.y;
                }
            }
        }
        return;
    }

    // 平移
    if (SMData.isPanning) {
        SMTool._onPanMove(e);
    }

    // 拖拽节点
    if (SMData.draggedNode) {
        var wp2 = SMTool.canvasToWorld(e.clientX, e.clientY);
        SMData.draggedNode.x = wp2.x - SMData.dragOffset.x;
        SMData.draggedNode.y = wp2.y - SMData.dragOffset.y;
        SMTool._updatePos(SMData.draggedNode);
    }

    // 控制点悬停检测
    if (!SMData.draggingCP && !SMData.draggedNode && !SMData.isPanning && !SMData.connecting) {
        var cp2 = SMTool._findCP(e.clientX, e.clientY, 14);
        if (cp2) {
            if (!SMData.hoveredCP || SMData.hoveredCP.connId !== cp2.connId || SMData.hoveredCP.which !== cp2.which) {
                SMData.hoveredCP = cp2;
                SMTool.gridCanvas.style.cursor = 'grab';
            }
        } else {
            if (SMData.hoveredCP) {
                SMData.hoveredCP = null;
                SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
            }
        }
    }
};

// ---- 鼠标释放 ----
SMTool._onMU = function (e) {
    // 结束控制点拖拽
    if (SMData.draggingCP) {
        SMData.draggingCP = null;
        SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
        setTimeout(function () { SMData.selectingCP = false; }, 50);
        return;
    }

    // 连线完成
    if (SMData.connecting) {
        var target = SMTool._findTarget(e.clientX, e.clientY);
        if (target && target.type === 'input' && target.nodeId !== SMData.connecting.nodeId) {
            var alreadyExists = false;
            for (var i = 0; i < SMData.connections.length; i++) {
                var ec = SMData.connections[i];
                if (ec.fromNode === SMData.connecting.nodeId && ec.fromState === SMData.connecting.stateName &&
                    ec.toNode === target.nodeId && ec.toState === target.stateName) {
                    alreadyExists = true;
                    break;
                }
            }
            if (!alreadyExists) {
                var fn = SMData.nodes.get(SMData.connecting.nodeId);
                var tn = SMData.nodes.get(target.nodeId);
                var fp = SMTool._getStateConnectorPos(fn, SMData.connecting.stateName, 'output');
                var tp = SMTool._getStateConnectorPos(tn, target.stateName, 'input');
                var def = fp && tp ? SMTool._defaultCPOffsets(fp, tp) : { cp1x: 50, cp1y: 0, cp2x: -50, cp2y: 0 };
                var colorIdx = SMData.connections.length;
                SMData.connections.push({
                    id: SMData.nextConnId++,
                    fromNode: SMData.connecting.nodeId,
                    fromState: SMData.connecting.stateName,
                    toNode: target.nodeId,
                    toState: target.stateName,
                    condition: '',
                    cp1x: def.cp1x, cp1y: def.cp1y,
                    cp2x: def.cp2x, cp2y: def.cp2y,
                    color: _connColor(colorIdx)
                });
                SMTool._updateSB();
            }
        }
        SMData.connecting = null;
        SMTool._updateSel();
        SMTool._updateStateRowColors();
    }

    // 右键空区域点击 → 取消选中
    if (e.button === 2 && SMData.isPanning) {
        var dx = e.clientX - SMData.panStart.x;
        var dy = e.clientY - SMData.panStart.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
            var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
            var found = false;
            var nodesIter = SMData.nodes.values();
            var result = nodesIter.next();
            while (!result.done) {
                if (SMTool._hitTest(result.value, wp.x, wp.y)) { found = true; break; }
                result = nodesIter.next();
            }
            if (!found) {
                SMData.selectedNode = null;
                SMData.selectedConnection = null;
                SMTool._updateSel();
                SMTool._updateStateRowColors();
            }
        }
    }

    SMData.isPanning = false;
    SMData.draggedNode = null;
    SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
};

// ---- 键盘 ----
SMTool._onKD = function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Delete' && SMData.selectedNode) SMTool.deleteNode(SMData.selectedNode);
    if (e.key === 'Escape') {
        SMData.connecting = null;
        SMData.connectMode = false;
        SMData.selectedConnection = null;
        document.getElementById('btnConnect').classList.remove('active');
        document.getElementById('conditionEditor').classList.remove('show');
        SMTool._updateSel();
        SMTool._updateStateRowColors();
    }
};

// ---- 节点头部拖拽 ----
SMTool._onHD = function (e, nid) {
    if (e.button === 1 || e.button === 2) {
        SMTool._onMD(e);
        return;
    }
    if (e.button !== 0) return;
    var n = SMData.nodes.get(nid);
    if (!n) return;
    SMData.selectedNode = nid;
    SMData.draggedNode = n;
    var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
    SMData.dragOffset = { x: wp.x - n.x, y: wp.y - n.y };
    SMTool._updateSel();
};

// ---- 状态行点击 ----
SMTool._onStateClick = function (nid, name) {
    var node = SMData.nodes.get(nid);
    if (!node || !node.state) return;
    // 如果正在连线模式 → 退出
    if (SMData.connectMode) {
        SMData.connectMode = false;
        document.getElementById('btnConnect').classList.remove('active');
        SMData.connecting = null;
        SMTool.gridCanvas.style.cursor = 'default';
        SMTool._updateSel();
    }
    node.state.setAnimation(0, name, true);
    node.currentAnim = name;
    SMTool._updateEl(node);
    SMTool._updateStateRowColors();
};

// ---- 连线圆点点击 ----
SMTool._onDot = function (nid, name, type) {
    if (!SMData.connectMode) {
        SMData.connectMode = true;
        document.getElementById('btnConnect').classList.add('active');
    }

    if (type === 'output') {
        var node = SMData.nodes.get(nid);
        if (!node) return;
        var pos = SMTool._getStateConnectorPos(node, name, 'output');
        var sp = SMTool.worldToCanvas(pos.x, pos.y);
        SMData.connecting = { nodeId: nid, stateName: name, sx: pos.x, sy: pos.y, mx: sp.x, my: sp.y };
        SMTool._updateSel();
    } else if (type === 'input' && SMData.connecting && SMData.connecting.nodeId !== nid) {
        // 快速连线（点击 input 圆点直接连）
        var alreadyExists = false;
        for (var i = 0; i < SMData.connections.length; i++) {
            var ec = SMData.connections[i];
            if (ec.fromNode === SMData.connecting.nodeId && ec.fromState === SMData.connecting.stateName &&
                ec.toNode === nid && ec.toState === name) {
                alreadyExists = true;
                break;
            }
        }
        if (!alreadyExists) {
            var fn = SMData.nodes.get(SMData.connecting.nodeId);
            var tn = SMData.nodes.get(nid);
            var fp = SMTool._getStateConnectorPos(fn, SMData.connecting.stateName, 'output');
            var tp = SMTool._getStateConnectorPos(tn, name, 'input');
            var def = fp && tp ? SMTool._defaultCPOffsets(fp, tp) : { cp1x: 50, cp1y: 0, cp2x: -50, cp2y: 0 };
            var colorIdx = SMData.connections.length;
            SMData.connections.push({
                id: SMData.nextConnId++,
                fromNode: SMData.connecting.nodeId,
                fromState: SMData.connecting.stateName,
                toNode: nid,
                toState: name,
                condition: '',
                cp1x: def.cp1x, cp1y: def.cp1y,
                cp2x: def.cp2x, cp2y: def.cp2y,
                color: _connColor(colorIdx)
            });
        }
        SMData.connecting = null;
        SMTool._updateSel();
        SMTool._updateSB();
        SMTool._updateStateRowColors();
    }
};

// ---- 查找连线目标 ----
SMTool._findTarget = function (mx, my) {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            var rows = el.querySelectorAll('.state-row');
            for (var i = 0; i < rows.length; i++) {
                var dot = rows[i].querySelector('.conn-dot.input');
                if (dot) {
                    var r = dot.getBoundingClientRect();
                    var dx = mx - r.left - r.width / 2;
                    var dy = my - r.top - r.height / 2;
                    if (Math.sqrt(dx * dx + dy * dy) < 20) {
                        return { nodeId: n.id, stateName: rows[i].dataset.state, type: 'input' };
                    }
                }
            }
        }
        result = nodesIter.next();
    }
    return null;
};

// ---- 高亮目标 ----
SMTool._highlightTarget = function (mx, my) {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            var rows = el.querySelectorAll('.state-row');
            for (var i = 0; i < rows.length; i++) {
                var dot = rows[i].querySelector('.conn-dot.input');
                if (dot) {
                    var r = dot.getBoundingClientRect();
                    var dx = mx - r.left - r.width / 2;
                    var dy = my - r.top - r.height / 2;
                    var near = Math.sqrt(dx * dx + dy * dy) < 20;
                    dot.style.transform = near ? 'scale(1.8)' : '';
                    dot.style.background = near ? '#4a90d9' : '';
                }
            }
        }
        result = nodesIter.next();
    }
};

// ---- 检测条件标签点击 ----
SMTool._checkConditionClick = function (mx, my) {
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        var fn = SMData.nodes.get(c.fromNode);
        var tn = SMData.nodes.get(c.toNode);
        if (!fn || !tn) continue;

        var fp = SMTool._getStateConnectorPos(fn, c.fromState, 'output');
        var tp = SMTool._getStateConnectorPos(tn, c.toState, 'input');
        if (!fp || !tp) continue;

        var fs = SMTool.worldToCanvas(fp.x, fp.y);
        var ts = SMTool.worldToCanvas(tp.x, tp.y);

        var cp1x = c.cp1x !== undefined ? c.cp1x : 50;
        var cp1y = c.cp1y !== undefined ? c.cp1y : 0;
        var cp2x = c.cp2x !== undefined ? c.cp2x : -50;
        var cp2y = c.cp2y !== undefined ? c.cp2y : 0;

        var cp1s = SMTool.worldToCanvas(fp.x + cp1x, fp.y + cp1y);
        var cp2s = SMTool.worldToCanvas(tp.x + cp2x, tp.y + cp2y);

        var mt = 0.5;
        var lx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var ly = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;

        if (Math.sqrt((mx - lx) * (mx - lx) + (my - ly) * (my - ly)) < 30) {
            SMData.selectedConnection = c.id;
            SMTool._updateStateRowColors();
            SMTool._showCond(c, mx, my);
            return true;
        }
    }
    return false;
};

// ---- 显示条件编辑器 ----
SMTool._showCond = function (conn, sx, sy) {
    var ed = document.getElementById('conditionEditor');
    ed.classList.add('show');
    ed.style.left = sx + 'px';
    ed.style.top = sy + 'px';
    ed._cid = conn.id;
    document.getElementById('condInput').value = conn.condition || '';
    document.getElementById('condInput').focus();
};

// ---- 右键菜单 ----
SMTool._showCtxMenu = function (e) {
    var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
    var found = null;
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        if (SMTool._hitTest(result.value, wp.x, wp.y)) { found = result.value; break; }
        result = nodesIter.next();
    }

    if (found) {
        SMData.selectedNode = found.id;
        SMTool._updateSel();
        var menu = document.getElementById('ctxMenu');
        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
    }
};
