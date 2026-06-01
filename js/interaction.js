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
        var cp = SMTool._findCP(e.clientX, e.clientY, 24);
        if (cp) {
            SMData.draggingCP = cp;
            SMData.selectingCP = true;
            SMTool.gridCanvas.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // 检测条件标签拖拽（拖拽标签改变贝塞尔曲线走势）
        var lr = SMTool._findLabel(e.clientX, e.clientY);
        if (lr) {
            var conn2 = null;
            for (var j = 0; j < SMData.connections.length; j++) {
                if (SMData.connections[j].id === lr.connId) {
                    conn2 = SMData.connections[j];
                    break;
                }
            }
            if (conn2) {
                SMData.draggingLabel = {
                    connId: lr.connId,
                    startCp1x: conn2.cp1x !== undefined ? conn2.cp1x : 50,
                    startCp1y: conn2.cp1y !== undefined ? conn2.cp1y : 0,
                    startCp2x: conn2.cp2x !== undefined ? conn2.cp2x : -50,
                    startCp2y: conn2.cp2y !== undefined ? conn2.cp2y : 0,
                    startMx: e.clientX,
                    startMy: e.clientY,
                    startSx: e.clientX,   // 用于判断是否拖拽
                    startSy: e.clientY
                };
                SMData.selectedConnection = lr.connId;
                SMTool._updateStateRowColors();
                SMTool.gridCanvas.style.cursor = 'grabbing';
                return;
            }
        }
    }

    // 中键/右键/Alt+左键 → 平移
    if (e.button === 2) {
        SMTool._onPanStart(e);
        SMTool.gridCanvas.style.cursor = 'grab';
        return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        SMTool._onPanStart(e);
        SMTool.gridCanvas.style.cursor = 'grab';
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
            // 连线模式：点击节点自身等同于点击其左侧端点完成连线
            if (SMData.connecting && found.id !== SMData.connecting.nodeId) {
                var alreadyExists2 = false;
                for (var ci3 = 0; ci3 < SMData.connections.length; ci3++) {
                    var ec2 = SMData.connections[ci3];
                    if (ec2.fromNode === SMData.connecting.nodeId && ec2.toNode === found.id) {
                        alreadyExists2 = true;
                        break;
                    }
                }
                if (!alreadyExists2) {
                    var ffn = SMData.nodes.get(SMData.connecting.nodeId);
                    var ttn = SMData.nodes.get(found.id);
                    var ffp = SMTool._getStateConnectorPos(ffn, SMData.connecting.stateName, 'output');
                    var ttp = SMTool._getStateConnectorPos(ttn, ttn.currentAnim || '', 'input');
                    var ddef = ffp && ttp ? SMTool._defaultCPOffsets(ffp, ttp) : { cp1x: 50, cp1y: 0, cp2x: -50, cp2y: 0 };
                    var cclrIdx = SMData.connections.length;
                    SMData.connections.push({
                        id: SMData.nextConnId++,
                        fromNode: SMData.connecting.nodeId,
                        fromState: SMData.connecting.stateName,
                        toNode: found.id,
                        toState: ttn ? (ttn.currentAnim || '') : '',
                        condition: '',
                        cp1x: ddef.cp1x, cp1y: ddef.cp1y,
                        cp2x: ddef.cp2x, cp2y: ddef.cp2y,
                        color: _connColor(cclrIdx)
                    });
                }
                SMData.connecting = null;
                // 清除所有连线状态残留
                var allDims = document.querySelectorAll('.spine-node .dim-overlay');
                for (var di2 = 0; di2 < allDims.length; di2++) { allDims[di2].remove(); }
                var allTargets = document.querySelectorAll('.spine-node .anim-bar .conn-dot.connecting-target, .spine-node .anim-bar .conn-dot.connecting-shrink');
                for (var dt = 0; dt < allTargets.length; dt++) {
                    allTargets[dt].classList.remove('connecting-target', 'connecting-shrink');
                }
                SMTool._updateSel();
                SMTool._updateSB();
                SMTool._updateStateRowColors();
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                // Ctrl+点击：切换选中
                if (SMData.selectedNodes.has(found.id)) {
                    SMData.selectedNodes.delete(found.id);
                } else {
                    SMData.selectedNodes.add(found.id);
                }
                SMData.selectedNode = null;
                if (SMData.selectedNodes.size > 0) {
                    SMData.selectedNode = SMData.selectedNodes.values().next().value;
                }
                SMData.selectedConnection = null;
                SMData.draggedNode = null;
                SMData.isMultiDragging = false;
                SMTool._updateStateRowColors();
                SMTool._updateSel();
            } else if (e.shiftKey) {
                // Shift+点击：只增不减
                if (!SMData.selectedNodes.has(found.id)) {
                    SMData.selectedNodes.add(found.id);
                }
                SMData.selectedNode = found.id;
                SMData.selectedConnection = null;
                SMData.draggedNode = null;
                SMData.isMultiDragging = false;
                SMTool._updateStateRowColors();
                SMTool._updateSel();
            } else if (SMData.selectedNodes.has(found.id) && SMData.selectedNodes.size > 1) {
                // 点击已选中的多选节点之一 → 开始多拖拽
                SMData.selectedNode = found.id;
                SMData.selectedConnection = null;
                SMData.isMultiDragging = true;
                SMData.multiDragOffsets.clear();
                var nodesIter2 = SMData.nodes.values();
                var result2 = nodesIter2.next();
                while (!result2.done) {
                    var n2 = result2.value;
                    if (SMData.selectedNodes.has(n2.id)) {
                        SMData.multiDragOffsets.set(n2.id, { x: wp.x - n2.x, y: wp.y - n2.y });
                    }
                    result2 = nodesIter2.next();
                }
                SMTool._updateStateRowColors();
                SMTool._updateSel();
            } else {
                // 普通点击：单选，如在组内则全选整组
                SMData.selectedNodes.clear();
                var grp = SMTool._findGroupOf(found.id);
                if (grp) {
                    grp.nodeIds.forEach(function (gid) { SMData.selectedNodes.add(gid); });
                    SMData.isMultiDragging = true;
                    SMData.draggedNode = null;
                    SMData.multiDragOffsets.clear();
                    grp.nodeIds.forEach(function (gid) {
                        var gn = SMData.nodes.get(gid);
                        if (gn) SMData.multiDragOffsets.set(gid, { x: wp.x - gn.x, y: wp.y - gn.y });
                    });
                } else {
                    SMData.selectedNodes.add(found.id);
                    SMData.draggedNode = found;
                    SMData.isMultiDragging = false;
                    SMData.dragOffset = { x: wp.x - found.x, y: wp.y - found.y };
                }
                SMData.selectedNode = found.id;
                SMData.selectedConnection = null;
                SMTool._updateStateRowColors();
                SMTool._updateSel();
            }
        } else {
            // 点击空白 → 开始框选
            if (!e.shiftKey) {
                SMData.selectedNode = null;
                SMData.selectedNodes.clear();
            }
            SMData.selectedConnection = null;
            SMData.draggedNode = null;
            SMData.isMultiDragging = false;
            SMData.marqueeActive = true;
            SMData.marqueeShift = !!e.shiftKey;
            SMData.marqueeStart.x = e.clientX;
            SMData.marqueeStart.y = e.clientY;
            SMData.marqueeEnd.x = e.clientX;
            SMData.marqueeEnd.y = e.clientY;
            SMTool.gridCanvas.style.cursor = 'crosshair';
            SMTool._updateStateRowColors();
            SMTool._updateSel();
        }
    }
};

// ---- 鼠标移动 ----
SMTool._onMM = function (e) {
    SMData._mx = e.clientX;
    SMData._my = e.clientY;

    // 框选模式：更新框选矩形
    if (SMData.marqueeActive) {
        SMData.marqueeEnd.x = e.clientX;
        SMData.marqueeEnd.y = e.clientY;
        return;
    }

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

    // 拖拽条件标签（整体移动贝塞尔曲线走势）
    if (SMData.draggingLabel) {
        var connL = null;
        for (var k = 0; k < SMData.connections.length; k++) {
            if (SMData.connections[k].id === SMData.draggingLabel.connId) {
                connL = SMData.connections[k];
                break;
            }
        }
        if (connL) {
            var dl = SMData.draggingLabel;
            // 将屏幕像素位移转换为世界坐标位移
            var dScreenX = e.clientX - dl.startMx;
            var dScreenY = e.clientY - dl.startMy;
            var dWorldX = dScreenX / SMData.view.zoom;
            var dWorldY = dScreenY / SMData.view.zoom;
            connL.cp1x = dl.startCp1x + dWorldX;
            connL.cp1y = dl.startCp1y + dWorldY;
            connL.cp2x = dl.startCp2x + dWorldX;
            connL.cp2y = dl.startCp2y + dWorldY;
        }
        return;
    }

    // 平移
    if (SMData.isPanning) {
        SMTool._onPanMove(e);
    }

    // 拖拽节点（单拖拽）
    if (SMData.draggedNode) {
        var wp2 = SMTool.canvasToWorld(e.clientX, e.clientY);
        SMData.draggedNode.x = wp2.x - SMData.dragOffset.x;
        SMData.draggedNode.y = wp2.y - SMData.dragOffset.y;
        SMTool._updatePos(SMData.draggedNode);
    }

    // 多节点拖拽（含组拖拽）
    if (SMData.isMultiDragging) {
        var wp3 = SMTool.canvasToWorld(e.clientX, e.clientY);
        var nodesIter3 = SMData.nodes.values();
        var result3 = nodesIter3.next();
        while (!result3.done) {
            var n3 = result3.value;
            if (SMData.multiDragOffsets.has(n3.id)) {
                var off = SMData.multiDragOffsets.get(n3.id);
                n3.x = wp3.x - off.x;
                n3.y = wp3.y - off.y;
                SMTool._updatePos(n3);
            }
            result3 = nodesIter3.next();
        }
    }

    // 控制点/标签悬停检测
    if (!SMData.draggingCP && !SMData.draggingLabel && !SMData.draggedNode && !SMData.isMultiDragging && !SMData.isPanning && !SMData.connecting) {
        var cp2 = SMTool._findCP(e.clientX, e.clientY, 24);
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
        // 标签悬停显示移动光标
        if (!cp2 && SMData._labelRects) {
            var lrH = SMTool._findLabel(e.clientX, e.clientY);
            if (lrH) {
                SMTool.gridCanvas.style.cursor = 'move';
            }
        }
    }

    // 条件标签悬浮提示（hover 任意条件框时在上一层级显示全部文本，不受画布缩放影响）
    var tt = document.getElementById('labelTooltip');
    var foundTooltip = false;
    if (SMData._labelRects) {
        for (var ri = 0; ri < SMData._labelRects.length; ri++) {
            var lr = SMData._labelRects[ri];
            if (e.clientX >= lr.x && e.clientX <= lr.x + lr.w &&
                e.clientY >= lr.y && e.clientY <= lr.y + lr.h) {
                tt.textContent = lr.rawLabel;
                tt.style.left = (e.clientX + 18) + 'px';
                tt.style.top = (e.clientY - 14) + 'px';
                tt.classList.add('show');
                foundTooltip = true;
                break;
            }
        }
    }
    if (!foundTooltip) {
        tt.classList.remove('show');
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

    // 结束标签拖拽
    if (SMData.draggingLabel) {
        var dl2 = SMData.draggingLabel;
        var dx2 = e.clientX - dl2.startSx;
        var dy2 = e.clientY - dl2.startSy;
        // 几乎没移动 → 视为点击，弹出条件编辑器
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < 4) {
            var connC = null;
            for (var m = 0; m < SMData.connections.length; m++) {
                if (SMData.connections[m].id === dl2.connId) {
                    connC = SMData.connections[m];
                    break;
                }
            }
            if (connC) {
                SMTool._showCond(connC, e.clientX, e.clientY);
            }
        }
        SMData.draggingLabel = null;
        SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
        return;
    }

    // 框选完成：选中矩形内完全覆盖的节点
    if (SMData.marqueeActive) {
        SMData.marqueeActive = false;
        var mx1 = Math.min(SMData.marqueeStart.x, SMData.marqueeEnd.x);
        var my1 = Math.min(SMData.marqueeStart.y, SMData.marqueeEnd.y);
        var mx2 = Math.max(SMData.marqueeStart.x, SMData.marqueeEnd.x);
        var my2 = Math.max(SMData.marqueeStart.y, SMData.marqueeEnd.y);
        var minSize = 5; // 最小框选尺寸，小于此值为点击

        if ((mx2 - mx1) > minSize || (my2 - my1) > minSize) {
            if (!SMData.marqueeShift) {
                SMData.selectedNodes.clear();
                SMData.selectedNode = null;
            }
            var nodesIter4 = SMData.nodes.values();
            var result4 = nodesIter4.next();
            while (!result4.done) {
                var n4 = result4.value;
                var el4 = SMTool._getEl(n4.id);
                if (el4) {
                    var r4 = el4.getBoundingClientRect();
                    // 检查节点是否完全在框选矩形内
                    if (r4.left >= mx1 && r4.top >= my1 && r4.right <= mx2 && r4.bottom <= my2) {
                        SMData.selectedNodes.add(n4.id);
                    }
                }
                result4 = nodesIter4.next();
            }
            if (SMData.selectedNodes.size > 0) {
                var first = null;
                SMData.selectedNodes.forEach(function (id) { if (!first) first = id; });
                SMData.selectedNode = first;
            }
        } else {
            // 微小移动视为空白点击：无 Shift 时取消选中
            if (!SMData.marqueeShift) {
                SMData.selectedNodes.clear();
                SMData.selectedNode = null;
            }
        }
        SMData.draggedNode = null;
        SMData.isMultiDragging = false;
        SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
        SMTool._updateStateRowColors();
        SMTool._updateSel();
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
                SMData.selectedNodes.clear();
                SMData.selectedConnection = null;
                SMTool._updateSel();
                SMTool._updateStateRowColors();
            }
        }
    }

    SMData.isPanning = false;
    SMData.draggedNode = null;
    SMData.isMultiDragging = false;
    SMData.multiDragOffsets.clear();
    SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
};

// ---- 键盘 ----
SMTool._onKD = function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // Ctrl+C：复制选中节点
    if (e.ctrlKey && e.key === 'c') {
        if (SMData.selectedNode) {
            SMData._clipboard = SMData.selectedNode;
            document.getElementById('sbStatus').textContent = '已复制: ' + (SMData.nodes.get(SMData.selectedNode) || {}).name;
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
        }
        e.preventDefault();
        return;
    }
    // Ctrl+V：粘贴节点
    if (e.ctrlKey && e.key === 'v') {
        if (SMData._clipboard && SMData.nodes.has(SMData._clipboard)) {
            var wp = SMTool.canvasToWorld(SMData._mx || window.innerWidth / 2, SMData._my || window.innerHeight / 2);
            var newNode = SMTool.copyNode(SMData._clipboard, 0, 0);
            if (newNode) {
                newNode.x = wp.x;
                newNode.y = wp.y;
                SMTool._updatePos(newNode);
                SMData.selectedNodes.clear();
                SMData.selectedNodes.add(newNode.id);
                SMData.selectedNode = newNode.id;
                SMTool._updateSel();
                SMTool._updateSB();
                SMTool._updateDuplicateHighlights();
                SMTool._checkMissingStates();
                SMTool._refreshAllTranslations();
                document.getElementById('sbStatus').textContent = '已粘贴';
                setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 1500);
            }
        }
        e.preventDefault();
        return;
    }
    if (e.key === 'Delete') {
        // 优先删除选中的连线
        if (SMData.selectedConnection) {
            SMData.connections = SMData.connections.filter(function (x) {
                return x.id !== SMData.selectedConnection;
            });
            SMData.selectedConnection = null;
            SMTool._updateSB();
            SMTool._updateStateRowColors();
            return;
        }
        if (SMData.selectedNodes.size > 1) {
            var toDelete = [];
            SMData.selectedNodes.forEach(function (id) { toDelete.push(id); });
            for (var i = 0; i < toDelete.length; i++) SMTool.deleteNode(toDelete[i]);
            SMData.selectedNodes.clear();
            SMData.selectedNode = null;
            SMTool._updateSel(); SMTool._updateSB();
            SMTool._updateStateRowColors(); SMTool._updateDuplicateHighlights(); SMTool._checkMissingStates();
        } else if (SMData.selectedNode) {
            SMTool.deleteNode(SMData.selectedNode);
        }
    }
    // Ctrl+G：打组
    if (e.ctrlKey && !e.shiftKey && e.key === 'g') {
        SMTool.groupSelection();
        e.preventDefault();
    }
    // Ctrl+Shift+G：取消选中节点所在组
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        if (SMData.selectedNode) {
            var ug = SMTool._findGroupOf(SMData.selectedNode);
            if (ug) {
                for (var ugi = 0; ugi < SMData.groups.length; ugi++) {
                    if (SMData.groups[ugi].id === ug.id) { SMData.groups.splice(ugi, 1); break; }
                }
                document.getElementById('sbStatus').textContent = '已取消打组';
                setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 1500);
            }
        }
        e.preventDefault();
    }
    if (e.key === 'Escape') {
        SMData.connecting = null;
        SMData.connectMode = false;
        SMData.selectedConnection = null;
        SMData.selectedNodes.clear();
        SMData.selectedNode = null;
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

    if (SMData.selectedNodes.has(nid) && SMData.selectedNodes.size > 1) {
        // 多选拖拽
        SMData.selectedNode = nid;
        SMData.selectedConnection = null;
        SMData.isMultiDragging = true;
        SMData.multiDragOffsets.clear();
        var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        while (!result.done) {
            var n2 = result.value;
            if (SMData.selectedNodes.has(n2.id)) {
                SMData.multiDragOffsets.set(n2.id, { x: wp.x - n2.x, y: wp.y - n2.y });
            }
            result = nodesIter.next();
        }
    } else {
        // 单选拖拽
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(nid);
        SMData.selectedNode = nid;
        SMData.draggedNode = n;
        SMData.isMultiDragging = false;
        var wp = SMTool.canvasToWorld(e.clientX, e.clientY);
        SMData.dragOffset = { x: wp.x - n.x, y: wp.y - n.y };
    }
    SMTool._updateSel();
};

// ---- 下拉框切换动画 ----
SMTool._onAnimChange = function (nid, animName) {
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
    node.state.setAnimation(0, animName, true);
    node.currentAnim = animName;
    node.name = SMTool._translateName(animName);
    SMTool._updateEl(node);
    SMTool._updateStateRowColors();
    SMTool._updateDuplicateHighlights();
    SMTool._checkMissingStates();
};

// ---- 旧的状态行点击（保留兼容，供手动创建的节点使用） ----
SMTool._onStateClick = function (nid, name) {
    SMTool._onAnimChange(nid, name);
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
        // 清除连线状态残留
        var allDims2 = document.querySelectorAll('.spine-node .dim-overlay');
        for (var di3 = 0; di3 < allDims2.length; di3++) { allDims2[di3].remove(); }
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
            var bar = el.querySelector('.anim-bar');
            if (bar) {
                var dot = bar.querySelector('.conn-dot.input');
                if (dot) {
                    var r = dot.getBoundingClientRect();
                    var dx = mx - r.left - r.width / 2;
                    var dy = my - r.top - r.height / 2;
                    if (Math.sqrt(dx * dx + dy * dy) < 24) {
                        var node = SMData.nodes.get(n.id);
                        var curState = node ? (node.currentAnim || '') : '';
                        return { nodeId: n.id, stateName: curState, type: 'input' };
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
            var bar = el.querySelector('.anim-bar');
            if (bar) {
                var dot = bar.querySelector('.conn-dot.input');
                if (dot) {
                    var r = dot.getBoundingClientRect();
                    var dx = mx - r.left - r.width / 2;
                    var dy = my - r.top - r.height / 2;
                    var near = Math.sqrt(dx * dx + dy * dy) < 24;
                    dot.style.transform = near ? 'scale(1.8)' : '';
                    dot.style.background = near ? '#4a90d9' : '';
                }
            }
        }
        result = nodesIter.next();
    }
};

// ---- 检测条件标签点击（也检测贝塞尔曲线上的点击） ----
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

        // 检测是否点击了标签位置（中点附近）
        var mt = 0.5;
        var lx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var ly = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;
        var distLabel = Math.sqrt((mx - lx) * (mx - lx) + (my - ly) * (my - ly));

        if (distLabel < 30) {
            // 点击了标签 → 选中连线 + 弹出条件编辑器
            SMData.selectedConnection = c.id;
            SMTool._updateStateRowColors();
            SMTool._showCond(c, mx, my);
            return true;
        }

        // 检测是否点击了贝塞尔曲线路径（采样20个点）
        var minDist = Infinity;
        for (var t = 0; t <= 1; t += 0.05) {
            var px = Math.pow(1 - t, 3) * fs.x + 3 * Math.pow(1 - t, 2) * t * cp1s.x + 3 * (1 - t) * t * t * cp2s.x + t * t * t * ts.x;
            var py = Math.pow(1 - t, 3) * fs.y + 3 * Math.pow(1 - t, 2) * t * cp1s.y + 3 * (1 - t) * t * t * cp2s.y + t * t * t * ts.y;
            var d = (mx - px) * (mx - px) + (my - py) * (my - py);
            if (d < minDist) minDist = d;
        }
        if (minDist < 100) { // 10px 距离内
            // 点击了曲线 → 仅选中连线显示控制杆，不弹编辑器
            SMData.selectedConnection = c.id;
            SMTool._updateStateRowColors();
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
    var ta = document.getElementById('condInput');
    ta.value = conn.condition || '';
    // 自适应高度
    setTimeout(function () {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
        ta.focus();
    }, 10);
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
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(found.id);
        SMData.selectedNode = found.id;
        SMTool._updateSel();
        var menu = document.getElementById('ctxMenu');
        var ungroupItem = menu.querySelector('.ctx-ungroup');
        if (ungroupItem) ungroupItem.remove();
        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
    } else {
        // 检查是否右键在分组区域内
        var ungrouped = SMTool.ungroupAt(wp.x, wp.y);
        if (!ungrouped) {
            SMData.selectedNode = null;
            SMData.selectedNodes.clear();
            SMData.selectedConnection = null;
            SMTool._updateSel();
            SMTool._updateStateRowColors();
        }
        // 空白区域右键菜单：创建文本节点 + 打组
        var menu3 = document.getElementById('ctxMenu');
        menu3.querySelectorAll('.ctx-text-node').forEach(function (el) { el.remove(); });
        var item1 = document.createElement('div');
        item1.className = 'ctx-item ctx-text-node';
        item1.textContent = '📝 创建短文本节点';
        item1.onclick = function () { SMTool.createShortTextNode(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item1);
        var item2 = document.createElement('div');
        item2.className = 'ctx-item ctx-text-node';
        item2.textContent = '📄 创建文本框节点';
        item2.onclick = function () { SMTool.createTextBoxNode(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item2);
        // 检查分组区域
        for (var g = 0; g < SMData.groups.length; g++) {
            var bb = SMTool._getGroupBounds(SMData.groups[g]);
            if (bb && wp.x >= bb.left && wp.x <= bb.right && wp.y >= bb.top && wp.y <= bb.bottom) {
                var item3 = document.createElement('div');
                item3.className = 'ctx-item ctx-ungroup';
                item3.textContent = '🔓 取消打组';
                item3.onclick = function () { SMTool.ungroupAt(wp.x, wp.y); menu3.style.display = 'none'; };
                menu3.appendChild(item3);
                break;
            }
        }
        menu3.style.display = 'block';
        menu3.style.left = e.clientX + 'px';
        menu3.style.top = e.clientY + 'px';
    }
};

// ================================================================
// 左侧浮窗面板交互 — 边缘检测 / 铆钉 / 离开收起
// ================================================================

// 浮窗面板状态
SMData._floatPanel = {
    pinned: false,       // 铆钉是否激活
    hovered: false,      // 鼠标是否在面板上
    expanded: false      // 当前是否展开
};

// 初始化浮窗面板事件
SMTool._initFloatPanel = function () {
    var panel = document.getElementById('dataFloatPanel');
    var pinBtn = panel.querySelector('.dfp-pin');
    var triggerIcon = panel.querySelector('.dfp-trigger-icon');
    var body = panel.querySelector('.dfp-body');

    // 用 mouseenter/mouseleave 分别监听 trigger 和 body（因为它们都有 pointer-events:all，面板容器是 none）
    function onPanelAreaEnter() {
        SMData._floatPanel.hovered = true;
        if (SMData._floatPanel._collapseTimer) {
            clearTimeout(SMData._floatPanel._collapseTimer);
            SMData._floatPanel._collapseTimer = null;
        }
        if (!SMData._floatPanel.expanded) {
            SMTool._expandFloatPanel();
        }
    }
    function onPanelAreaLeave(e) {
        SMData._floatPanel.hovered = false;
        SMTool._scheduleFloatPanelCollapse(e);
    }

    triggerIcon.addEventListener('mouseenter', onPanelAreaEnter);
    triggerIcon.addEventListener('mouseleave', onPanelAreaLeave);
    body.addEventListener('mouseenter', onPanelAreaEnter);
    body.addEventListener('mouseleave', onPanelAreaLeave);

    // 点击铆钉图标切换固定状态
    pinBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        SMData._floatPanel.pinned = !SMData._floatPanel.pinned;
        if (SMData._floatPanel.pinned) {
            pinBtn.classList.add('active');
            pinBtn.title = '取消固定';
            panel.classList.add('pinned');
        } else {
            pinBtn.classList.remove('active');
            pinBtn.title = '固定面板';
            panel.classList.remove('pinned');
            // 取消固定后，检查鼠标是否还在面板上
            if (!SMData._floatPanel.hovered) {
                SMTool._scheduleFloatPanelCollapse(null);
            }
        }
    });

    // 点击触发器图标也能展开/收起
    triggerIcon.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!SMData._floatPanel.pinned) {
            if (SMData._floatPanel.expanded) {
                SMTool._collapseFloatPanel();
            } else {
                SMTool._expandFloatPanel();
            }
        }
    });

    // 全局鼠标移动 — 检测靠近左边缘
    document.addEventListener('mousemove', function (e) {
        if (SMData._floatPanel.pinned || SMData._floatPanel.expanded) return;
        if (e.clientX <= 15) {
            SMTool._expandFloatPanel();
        }
    });

    // 全局鼠标移动 — 检测是否远离面板（50px 阈值）
    document.addEventListener('mousemove', function (e) {
        if (SMData._floatPanel.pinned) return;
        if (!SMData._floatPanel.expanded) return;

        var rect = panel.getBoundingClientRect();
        var panelRight = rect.right;
        if (e.clientX > panelRight + 50 || e.clientX < rect.left - 50) {
            SMTool._collapseFloatPanel();
        }
    });
};

// 展开面板
SMTool._expandFloatPanel = function () {
    if (SMData._floatPanel.expanded) return;
    SMData._floatPanel.expanded = true;
    var panel = document.getElementById('dataFloatPanel');
    if (panel) panel.classList.add('expanded');
};

// 收起面板
SMTool._collapseFloatPanel = function () {
    if (!SMData._floatPanel.expanded) return;
    if (SMData._floatPanel.pinned) return;
    SMData._floatPanel.expanded = false;
    var panel = document.getElementById('dataFloatPanel');
    if (panel) panel.classList.remove('expanded');
};

// 延迟收起（鼠标离开面板时使用，留一点缓冲）
SMTool._scheduleFloatPanelCollapse = function (e) {
    // 清除之前的定时器
    if (SMData._floatPanel._collapseTimer) {
        clearTimeout(SMData._floatPanel._collapseTimer);
    }
    SMData._floatPanel._collapseTimer = setTimeout(function () {
        // 再次检查鼠标是否确实离开了面板区域
        if (!SMData._floatPanel.hovered && !SMData._floatPanel.pinned) {
            var panel = document.getElementById('dataFloatPanel');
            if (panel) {
                var rect = panel.getBoundingClientRect();
                // 面板实际占据的右侧边缘
                var panelRight = rect.right;
                // 当前鼠标位置（使用 SMData 中记录的鼠标坐标）
                var mx = SMData._mx || 0;
                if (mx > panelRight + 50 || mx < rect.left) {
                    SMTool._collapseFloatPanel();
                }
            }
        }
    }, 150);
};

// ================================================================
// 骨骼标签交互 — 点击骨骼行添加/编辑/删除标签（按动画状态隔离）
// ================================================================
SMTool._initBoneLabelEvents = function () {
    var content = document.getElementById('dfpContent');
    if (!content) return;

    content.addEventListener('click', function (e) {
        // 骨骼标记按钮
        var tagBtn = e.target.closest('.dfp-bone-tag-btn');
        if (tagBtn) {
            e.stopPropagation();
            var boneName = tagBtn.getAttribute('data-bone');
            SMTool._toggleBoneTag(boneName);
            return;
        }

        // 删除标签
        var delBtn = e.target.closest('.dfp-bone-label-del');
        if (delBtn) {
            e.stopPropagation();
            var boneName = delBtn.getAttribute('data-bone');
            SMTool._removeBoneLabel(boneName);
            return;
        }

        // 点击已有标签 → 进入编辑
        var labelEl = e.target.closest('.dfp-bone-label');
        if (labelEl) {
            e.stopPropagation();
            var boneName = labelEl.getAttribute('data-bone');
            SMTool._startBoneLabelEdit(boneName, labelEl.textContent.replace('×', '').trim());
            return;
        }

        // 点击骨骼行空白区域 → 添加标签
        var boneRow = e.target.closest('.dfp-bone-row');
        if (boneRow) {
            var boneName = boneRow.getAttribute('data-bone');
            // 如果已有标签 → 编辑；否则 → 新建
            var existingLabel = boneRow.querySelector('.dfp-bone-label');
            if (existingLabel) {
                SMTool._startBoneLabelEdit(boneName, existingLabel.textContent.replace('×', '').trim());
            } else {
                SMTool._startBoneLabelEdit(boneName, '');
            }
        }
    });
};

// 开始编辑/新建骨骼标签（显示内联输入框）
SMTool._startBoneLabelEdit = function (boneName, currentText) {
    // 手动转义属性选择器中的特殊字符
    var escaped = boneName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var boneRow = document.querySelector('.dfp-bone-row[data-bone="' + escaped + '"]');
    if (!boneRow) return;

    var rightEl = boneRow.querySelector('.dfp-bone-right');
    if (!rightEl) return;

    // 替换为输入框
    var input = document.createElement('input');
    input.className = 'dfp-bone-input';
    input.value = currentText;
    input.setAttribute('data-bone', boneName);
    input.placeholder = '输入标签...';
    rightEl.innerHTML = '';
    rightEl.appendChild(input);

    // 自动聚焦并选中
    input.focus();
    if (currentText) input.select();

    // 回车/失焦保存
    function save() {
        var val = input.value.trim();
        if (val) {
            SMTool._saveBoneLabel(boneName, val);
        } else {
            SMTool._removeBoneLabel(boneName);
        }
    }
    input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); save(); }
        if (ev.key === 'Escape') { SMTool._updateFloatPanel(); }
    });
    input.addEventListener('blur', function () {
        // 延迟保存，避免点击其他元素时冲突
        setTimeout(function () {
            if (document.contains(input)) {
                save();
            }
        }, 100);
    });
};

// 保存骨骼标签（全局存储，按源文件+动画状态关联，节点删创不丢失）
SMTool._saveBoneLabel = function (boneName, labelText) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;

    var storeKey = (node.sourceFile || node.name) + '||' + (node.currentAnim || '');
    if (!SMData._boneLabelStore[storeKey]) SMData._boneLabelStore[storeKey] = {};
    SMData._boneLabelStore[storeKey][boneName] = labelText;

    SMTool._updateFloatPanel();
};

// 删除骨骼标签
SMTool._removeBoneLabel = function (boneName) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;

    var storeKey = (node.sourceFile || node.name) + '||' + (node.currentAnim || '');
    if (SMData._boneLabelStore[storeKey]) {
        delete SMData._boneLabelStore[storeKey][boneName];
        if (Object.keys(SMData._boneLabelStore[storeKey]).length === 0) {
            delete SMData._boneLabelStore[storeKey];
        }
    }

    SMTool._updateFloatPanel();
};
