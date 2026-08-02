/* ================================================================
   交互事件 — 鼠标、键盘、拖拽处理
   负责: 所有用户交互（点击选中、拖拽移动、连线、条件编辑）
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// 右键取消拉线：只退出连线交互并刷新焦点，不触发画布平移或右键功能菜单。
SMTool._cancelConnectModeForContextMenu = function () {
    if (!SMData.connecting && !SMData.connectMode) return false;
    SMData.connecting = null;
    SMData.connectMode = false;
    SMData._suppressContextMenuUntil = Date.now() + 800;
    var connectButton = document.getElementById('btnConnect');
    if (connectButton) connectButton.classList.remove('active');
    var contextMenu = document.getElementById('ctxMenu');
    if (contextMenu) contextMenu.style.display = 'none';
    if (SMTool.gridCanvas) SMTool.gridCanvas.style.cursor = 'default';
    SMData._forceRedraw = true;
    if (typeof SMTool._setHighlightedTargetNode === 'function') SMTool._setHighlightedTargetNode(null);
    if (typeof SMTool._updateSel === 'function') SMTool._updateSel();
    if (typeof SMTool._updateStateRowColors === 'function') SMTool._updateStateRowColors();
    return true;
};

// ---- 鼠标按下 ----
SMTool._onMD = function (e) {
    // 滚轮停止后的极短提交窗口内若立即点击，先原子提交视图，保证命中坐标
    // 与用户眼中已经缩放后的节点完全一致。
    if (SMData._viewProxy && SMData._viewProxy.active && !SMData.isPanning &&
        typeof SMTool._commitViewProxy === 'function') {
        SMTool._commitViewProxy();
    }
    // ★ 层拖拽排序激活时，禁止画布级操作
    if (SMData._layerReorderActive) return;
    // 拉线期间右键只负责取消连线。必须在平移和右键菜单逻辑之前消费本次事件。
    if (e.button === 2 && SMTool._cancelConnectModeForContextMenu()) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    // ================================================================
    // 🔒🔒🔒 [LOCK-5] 画布点击退出动画流
    // ⚠️ 解锁策略：仅用户明确说「解锁 LOCK-5」才能改！
    //
    // 退出条件：isPlaying（点了播放）或 _stepped（点了上一步/下一步）
    //          或存在 _pausedByFlow 节点（兜底）
    // 仅选中路径（未播放/未导航）→ 不退出，画布动画继续
    // ================================================================
    if (e.button === 0) {
        var pb = SMData._fullPlayback;
        var inFlow = pb.isPlaying || pb._stepped;
        if (!inFlow) {
            var nodesIter3 = SMData.nodes.values();
            var nr3 = nodesIter3.next();
            while (!nr3.done) { if (nr3.value._pausedByFlow) { inFlow = true; break; } nr3 = nodesIter3.next(); }
        }
        if (inFlow) {
            SMData._flowExitLock = true;
            pb.isPlaying = false;
            pb.activePathIdx = -1;
            pb.currentStep = 0;
            pb._stepped = false;
            if (pb._timer) { clearTimeout(pb._timer); pb._timer = null; }
            if (SMData._animPreview) SMData._animPreview._flowFrozen = false;
            SMTool._clearAllProgressBars();
            // ★ 强制恢复所有节点（_forceResetAllNodes 不依赖状态标记，暴力恢复）
            SMTool._forceResetAllNodes();
            SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
            SMTool._updateSel();
            SMTool._updateStateRowColors();
            setTimeout(function () { SMData._flowExitLock = false; }, 200);
        }
    }
    // 🔒 [LOCK-5] END

    // 优先检测控制点点击
    if (e.button === 0 && !e.altKey) {
        var cp = SMTool._findCP(e.clientX, e.clientY, 24);
        if (cp) {
            SMData._pendingDragSnap = SMTool._snapshotState();
            SMData.draggingCP = cp;
            SMData.selectingCP = true;
            SMTool.gridCanvas.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // ★ 检测条件框删除按钮（×） — 必须在 _findLabel（标签拖拽）之前处理
        if (SMData._labelRects && SMData._labelRects.length > 0) {
            if (!SMData._lblLogOnce) { SMData._lblLogOnce = true; console.log('[×] _labelRects sample:', SMData._labelRects.length + ' rects, first closeArea=(' + Math.round(SMData._labelRects[0].closeX) + ',' + Math.round(SMData._labelRects[0].closeY) + ',' + SMData._labelRects[0].closeW + 'x' + SMData._labelRects[0].closeH + ')'); }
            for (var lri = 0; lri < SMData._labelRects.length; lri++) {
                var lrc = SMData._labelRects[lri];
                if (lrc.closeX !== undefined &&
                    e.clientX >= lrc.closeX && e.clientX <= lrc.closeX + lrc.closeW &&
                    e.clientY >= lrc.closeY && e.clientY <= lrc.closeY + lrc.closeH) {
                    for (var cd = 0; cd < SMData.connections.length; cd++) {
                        if (SMData.connections[cd].id === lrc.connId) {
                            SMData.connections[cd].condition = '';
                            SMData.connections[cd]._hideLabel = true;
                            break;
                        }
                    }
                    SMData.selectedConnection = null;
                    SMData._forceRedraw = true;
                    SMTool._updateSB();
                    SMTool._updateFlowPanel();
                    e.preventDefault();
                    return;
                }
            }
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
                SMData._pendingDragSnap = SMTool._snapshotState();
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

    // 中键/右键 → 平移；Alt+左键 → 若点组内节点则穿透选单个，否则平移
    if (e.button === 2) {
        SMTool._onPanStart(e);
        document.body.style.cursor = 'move';
        return;
    }
    if (e.button === 1) {
        e.preventDefault();
        SMTool._onPanStart(e);
        document.body.style.cursor = 'move';
        return;
    }
    if (e.button === 0 && e.altKey) {
        // Alt+左键：检测是否点中组内节点
        var wpAlt = SMTool.canvasToWorld(e.clientX, e.clientY);
        var foundAlt = null;
        var nodesIterAlt = SMData.nodes.values();
        var rAlt = nodesIterAlt.next();
        while (!rAlt.done) {
            if (SMTool._hitTest(rAlt.value, wpAlt.x, wpAlt.y)) { foundAlt = rAlt.value; break; }
            rAlt = nodesIterAlt.next();
        }
        if (foundAlt && SMTool._findGroupOf(foundAlt.id)) {
            // Alt+点组内节点 → 穿透，不平移，到下方普通点击逻辑选单个节点
        } else {
            e.preventDefault();
            SMTool._onPanStart(e);
            document.body.style.cursor = 'move';
            return;
        }
    }

    // ★ 空格+左键 → 平移画布（等同鼠标中键拖拽）
    if (e.button === 0 && SMData._spacePanning) {
        e.preventDefault();
        SMTool._onPanStart(e);
        document.body.style.cursor = 'move';
        return;
    }

    // 左键 — 画布点击
    if (e.button === 0) {
        // 完整模式：点击新节点时清除旧焦点，让_updateSel重新计算
        if (SMData.flowMode === 'full') {
            SMData._flowFocus = null;
        } else {
            SMData._flowFocus = null;
        }
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
                var directFocusSource = SMData.connecting.nodeId;
                var alreadyExists2 = false;
                for (var ci3 = 0; ci3 < SMData.connections.length; ci3++) {
                    var ec2 = SMData.connections[ci3];
                    if (ec2.fromNode === SMData.connecting.nodeId && ec2.toNode === found.id) {
                        alreadyExists2 = true;
                        break;
                    }
                }
                if (!alreadyExists2) {
                    SMTool.pushUndo();
                    var ffn = SMData.nodes.get(SMData.connecting.nodeId);
                    var ttn = SMData.nodes.get(found.id);
                    var toState = (ttn && ttn.nodeType === 'exit') ? 'exit' : (ttn && ttn.nodeType === 'entry') ? 'entry' : (ttn ? (ttn.currentAnim || '') : '');
                    var ffp = SMTool._getStateConnectorPos(ffn, SMData.connecting.stateName, 'output');
                    var ttp = SMTool._getStateConnectorPos(ttn, toState, 'input');
                    var ddef = ffp && ttp ? SMTool._defaultCPOffsets(ffp, ttp) : { cp1x: 50, cp1y: 0, cp2x: -50, cp2y: 0 };
                    var cclrIdx = SMData.connections.length;
                    SMData.connections.push({
                        id: SMData.nextConnId++,
                        fromNode: SMData.connecting.nodeId,
                        fromState: SMData.connecting.stateName,
                        toNode: found.id,
                        toState: toState,
                        condition: '',
                        _mixDuration: 0,
                        cp1x: ddef.cp1x, cp1y: ddef.cp1y,
                        cp2x: ddef.cp2x, cp2y: ddef.cp2y,
                        color: _connColor(cclrIdx)
                    });
                }
                SMData.connecting = null;
                if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(directFocusSource);
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
                // ★ 即时刷新层级
                if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
                if (typeof SMTool._refreshLayerPreviewIfOpen === 'function') {
                    var ffn2 = SMData.nodes.get(ffn ? ffn.id : -1);
                    if (ffn2 && ffn2.nodeType === 'layer') SMTool._refreshLayerPreviewIfOpen(ffn2);
                }
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
                // ★ 点击节点立即显示预览浮窗
                if (found.nodeType === 'spine' || found.nodeType === 'layer') SMTool._showAnimPreview(found);
            } else if (SMData.selectedNodes.has(found.id) && SMData.selectedNodes.size > 1) {
                // 点击已选中的多选节点之一 → 开始多拖拽
                SMData._pendingDragSnap = SMTool._snapshotState();
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
                // 普通点击：单选，如在组内则全选整组（Alt+点击或组编辑模式则穿透选单个）
                SMData.selectedNodes.clear();
                var grp = SMTool._findGroupOf(found.id);
                var inEditMode = SMData._groupEditMode && grp && grp.id === SMData._groupEditMode;
                if (grp && !e.altKey && !inEditMode) {
                    SMData._pendingDragSnap = SMTool._snapshotState();
                    grp.nodeIds.forEach(function (gid) { SMData.selectedNodes.add(gid); });
                    SMData.isMultiDragging = true;
                    SMData.draggedNode = null;
                    SMData.multiDragOffsets.clear();
                    grp.nodeIds.forEach(function (gid) {
                        var gn = SMData.nodes.get(gid);
                        if (gn) SMData.multiDragOffsets.set(gid, { x: wp.x - gn.x, y: wp.y - gn.y });
                    });
                    // ★ 追溯组内源头节点（无入边的节点），设为 selectedNode
                    var sourceNode = SMTool._findGroupSource(grp);
                    if (sourceNode) found = sourceNode;
                } else {
                    SMData._pendingDragSnap = SMTool._snapshotState();
                    SMData.selectedNodes.add(found.id);
                    SMData.draggedNode = found;
                    SMData.isMultiDragging = false;
                    SMData.dragOffset = { x: wp.x - found.x, y: wp.y - found.y };
                }
                SMData.selectedNode = found.id;
                SMData.selectedConnection = null;
                SMTool._updateStateRowColors();
                SMTool._updateSel();
                // ★ 点击节点立即显示预览浮窗
                if (found.nodeType === 'spine' || found.nodeType === 'layer') SMTool._showAnimPreview(found);
            }
        } else {
            // 点击空白 → 退出组编辑模式 + 开始框选
            if (SMData._groupEditMode) { SMData._groupEditMode = null; SMTool._updateSel(); }
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
    // ★ 层级预览位置拖拽
    SMTool._onLayerPosMouseMove(e);
    if (SMData._animPreview && SMData._animPreview._layerDragActive) return;
    // ★ 层拖拽排序激活时，禁止画布级操作
    if (SMData._layerReorderActive) return;
    SMData._mx = e.clientX;
    SMData._my = e.clientY;

    // 框选模式：更新框选矩形
    if (SMData.marqueeActive) {
        SMData.marqueeEnd.x = e.clientX;
        SMData.marqueeEnd.y = e.clientY;
        return;
    }

    // 节点缩放拖拽
    if (SMData.scalingNode) {
        var sn = SMData.scalingNode;
        var node2 = SMData.nodes.get(sn.nodeId);
        if (node2) {
            var dScreenX = e.clientX - sn.startMx;
            var dScreenY = e.clientY - sn.startMy;
            var dist = (dScreenX + dScreenY) * 0.5;
            var scaleChange = dist / 200;
            var newScale = sn.startScale + scaleChange;
            newScale = Math.max(0.2, Math.min(5.0, newScale));
            node2._customScale = newScale;
            SMTool._updatePos(node2);
            // ★ 缩放时强制重绘连线，确保连线跟随节点大小变化
            SMData._forceRedraw = true;
        }
        return;
    }

    // 连线模式
    if (SMData.connecting) {
        SMData.connecting.mx = e.clientX;
        SMData.connecting.my = e.clientY;
        SMData._forceRedraw = true;
        SMTool._highlightTarget(e.clientX, e.clientY);
    }

    // 拖拽控制点
    if (SMData.draggingCP) {
        SMData._forceRedraw = true;
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
        SMData._forceRedraw = true;
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
        SMData._forceRedraw = true;
        var wp2 = SMTool.canvasToWorld(e.clientX, e.clientY);
        SMData.draggedNode.x = wp2.x - SMData.dragOffset.x;
        SMData.draggedNode.y = wp2.y - SMData.dragOffset.y;
        SMTool._updatePos(SMData.draggedNode);
        SMTool._applySnapToDrag([SMData.draggedNode], false);
    }

    // 多节点拖拽（含组拖拽）
    if (SMData.isMultiDragging) {
        SMData._forceRedraw = true;
        var wp3 = SMTool.canvasToWorld(e.clientX, e.clientY);
        var draggedList = [];
        var nodesIter3 = SMData.nodes.values();
        var result3 = nodesIter3.next();
        while (!result3.done) {
            var n3 = result3.value;
            if (SMData.multiDragOffsets.has(n3.id)) {
                var off = SMData.multiDragOffsets.get(n3.id);
                n3.x = wp3.x - off.x;
                n3.y = wp3.y - off.y;
                SMTool._updatePos(n3);
                draggedList.push(n3);
            }
            result3 = nodesIter3.next();
        }
        SMTool._applySnapToDrag(draggedList, true);
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

// ---- 拖拽吸附对齐 ----
SMTool._applySnapToDrag = function (draggedNodesM, isMulti) {
    if (!draggedNodesM || draggedNodesM.length === 0) return;
    if (!SMData._snapEnabled) { SMData._snapLines = []; return; }
    var THRESHOLD = 4 / Math.max(0.03, SMData.view.zoom); // 屏幕 4px 转为世界坐标

    // 计算拖拽对象的包围盒
    var dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
    for (var i = 0; i < draggedNodesM.length; i++) {
        var r = SMTool._getNodeWorldRect(draggedNodesM[i], { avoidLayout: true });
        if (r.left < dMinX) dMinX = r.left;
        if (r.right > dMaxX) dMaxX = r.right;
        if (r.top < dMinY) dMinY = r.top;
        if (r.bottom > dMaxY) dMaxY = r.bottom;
    }
    var dCX = (dMinX + dMaxX) / 2;
    var dCY = (dMinY + dMaxY) / 2;

    var bestX = null, bestDx = 0, bestDistX = THRESHOLD;
    var bestY = null, bestDy = 0, bestDistY = THRESHOLD;

    // 遍历所有非拖拽节点，检测边缘对齐
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var isDragged = false;
        for (var j = 0; j < draggedNodesM.length; j++) {
            if (draggedNodesM[j].id === n.id) { isDragged = true; break; }
        }
        if (!isDragged) {
            var nr = SMTool._getNodeWorldRect(n, { avoidLayout: true });
            var nCX = (nr.left + nr.right) / 2;
            var nCY = (nr.top + nr.bottom) / 2;

            // X 方向：拖拽对象左/右/中 ↔ 参考节点左/右/中
            var pairsX = [
                [dMinX, nr.left], [dMinX, nr.right], [dMinX, nCX],
                [dMaxX, nr.left], [dMaxX, nr.right], [dMaxX, nCX],
                [dCX, nr.left], [dCX, nr.right], [dCX, nCX]
            ];
            for (var xi = 0; xi < pairsX.length; xi++) {
                var dist = Math.abs(pairsX[xi][0] - pairsX[xi][1]);
                if (dist < bestDistX) {
                    bestDistX = dist;
                    bestX = pairsX[xi][1];
                    bestDx = pairsX[xi][1] - pairsX[xi][0];
                }
            }

            // Y 方向：拖拽对象上/下/中 ↔ 参考节点上/下/中
            var pairsY = [
                [dMinY, nr.top], [dMinY, nr.bottom], [dMinY, nCY],
                [dMaxY, nr.top], [dMaxY, nr.bottom], [dMaxY, nCY],
                [dCY, nr.top], [dCY, nr.bottom], [dCY, nCY]
            ];
            for (var yi = 0; yi < pairsY.length; yi++) {
                var distY = Math.abs(pairsY[yi][0] - pairsY[yi][1]);
                if (distY < bestDistY) {
                    bestDistY = distY;
                    bestY = pairsY[yi][1];
                    bestDy = pairsY[yi][1] - pairsY[yi][0];
                }
            }
        }
        result = nodesIter.next();
    }

    SMData._snapLines = [];

    // 应用 X 吸附：调整节点位置 + 同步修正拖拽偏移量（防止下一帧被鼠标位置覆盖）
    if (bestX !== null && bestDistX < THRESHOLD) {
        for (var i = 0; i < draggedNodesM.length; i++) {
            draggedNodesM[i].x += bestDx;
            SMTool._updatePos(draggedNodesM[i]);
        }
        // 同步修正拖拽偏移，使吸附生效后不会被鼠标覆盖
        if (!isMulti && SMData.draggedNode) {
            SMData.dragOffset.x -= bestDx;
        }
        if (isMulti) {
            var keysIter = SMData.multiDragOffsets.keys();
            var kResult = keysIter.next();
            while (!kResult.done) {
                var off = SMData.multiDragOffsets.get(kResult.value);
                if (off) off.x -= bestDx;
                kResult = keysIter.next();
            }
        }
        SMData._snapLines.push({ dir: 'v', pos: bestX });
    }

    // 应用 Y 吸附
    if (bestY !== null && bestDistY < THRESHOLD) {
        for (var i = 0; i < draggedNodesM.length; i++) {
            draggedNodesM[i].y += bestDy;
            SMTool._updatePos(draggedNodesM[i]);
        }
        if (!isMulti && SMData.draggedNode) {
            SMData.dragOffset.y -= bestDy;
        }
        if (isMulti) {
            var keysIter = SMData.multiDragOffsets.keys();
            var kResult = keysIter.next();
            while (!kResult.done) {
                var off = SMData.multiDragOffsets.get(kResult.value);
                if (off) off.y -= bestDy;
                kResult = keysIter.next();
            }
        }
        SMData._snapLines.push({ dir: 'h', pos: bestY });
    }
};

// ---- 鼠标释放 ----
SMTool._onMU = function (e) {
    // ★ 层级预览位置拖拽结束
    SMTool._onLayerPosMouseUp();
    // ★ 层拖拽排序激活时：仅阻塞画布操作，由 _initLayerDrag 内的 onReorderUp 处理
    if (SMData._layerReorderActive) return;

    // 结束节点缩放拖拽
    // 结束节点缩放拖拽
    if (SMData.scalingNode) {
        SMData.scalingNode = null;
        SMTool._commitDragUndo();
        SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
        return;
    }

    // 结束控制点拖拽
    if (SMData.draggingCP) {
        SMData.draggingCP = null;
        SMTool._commitDragUndo();
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
                // ★ 取条件框底部 + 中心 X
                var cx2 = e.clientX, by2 = e.clientY;
                if (SMData._labelRects) {
                    for (var lrj = 0; lrj < SMData._labelRects.length; lrj++) {
                        if (SMData._labelRects[lrj].connId === connC.id) {
                            var lr2 = SMData._labelRects[lrj];
                            cx2 = lr2.x + lr2.w / 2;
                            by2 = lr2.y + lr2.h;
                            break;
                        }
                    }
                }
                SMTool._showCond(connC, cx2, by2);
            }
        }
        SMData.draggingLabel = null;
        SMTool._commitDragUndo();
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
        var directFocusSource2 = SMData.connecting.nodeId;
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
                SMTool.pushUndo();
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
                    _mixDuration: 0,
                    cp1x: def.cp1x, cp1y: def.cp1y,
                    cp2x: def.cp2x, cp2y: def.cp2y,
                    color: _connColor(colorIdx)
                });
                SMTool._updateSB();
            }
        }
        SMData.connecting = null;
        if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(directFocusSource2);
        SMTool._updateSel();
        SMTool._updateStateRowColors();
        // ★ 即时刷新层级
        if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
        if (typeof SMTool._refreshLayerPreviewIfOpen === 'function') {
            var fnR = SMData.nodes.get(fn ? fn.id : -1);
            if (fnR && fnR.nodeType === 'layer') SMTool._refreshLayerPreviewIfOpen(fnR);
        }
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

    // [LOCK-PREVIEW-FPS-4] [BASELINE-20260802-2327] 平移期间只移动整块 #app 代理；
    // 松手时统一提交真实 view，禁止在交互热路径逐节点重绘并抢占浮窗动画帧预算。
    if (SMData.isPanning && typeof SMTool._onPanEnd === 'function') SMTool._onPanEnd();
    else SMData.isPanning = false;
    SMData.draggedNode = null;
    SMData.isMultiDragging = false;
    SMData.multiDragOffsets.clear();
    SMData._snapLines = [];
    SMTool._commitDragUndo();
    document.body.style.cursor = '';
    SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
};

// ---- 键盘 ----
SMTool._onKD = function (e) {
    // ★ 空格键按下 → 标记待平移状态（需配合左键点击拖拽画布）
    if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (!SMData._spacePanning) {
            SMData._spacePanning = true;
            document.body.style.cursor = 'move';
        }
        return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // Ctrl+C：复制选中的所有节点及它们之间的连线
    if (e.ctrlKey && e.key === 'c') {
        // 收集所有选中的节点 ID
        var selIds = new Set();
        if (SMData.selectedNodes.size > 0) {
            SMData.selectedNodes.forEach(function (id) { selIds.add(id); });
        } else if (SMData.selectedNode) {
            selIds.add(SMData.selectedNode);
        }

        if (selIds.size > 0) {
            var cb = { nodes: [], connections: [] };

            // 序列化选中的节点
            selIds.forEach(function (nid) {
                var n = SMData.nodes.get(nid);
                if (!n) return;
                cb.nodes.push({
                    name: n.name,
                    nodeType: n.nodeType || 'spine',
                    x: n.x,
                    y: n.y,
                    width: n.width || 300,
                    sourceFile: n.sourceFile || '',
                    animations: n.animations ? n.animations.slice() : [],
                    skins: n.skins ? n.skins.slice() : [],
                    slots: n.slots ? n.slots.slice() : [],
                    bones: n.bones ? n.bones.slice() : [],
                    version: n.version || '',
                    currentAnim: n.currentAnim || '',
                    currentSkin: n.currentSkin || '',
                    premultipliedAlpha: !!n.premultipliedAlpha,
                    loop: n.loop !== undefined ? n.loop : true,
                    _srcSkelJson: n._srcSkelJson,
                    _srcSkelBinBase64: n._srcSkelBinBase64,
                    _srcAtlasText: n._srcAtlasText || '',
                    _srcTexDataUrl: n._srcTexDataUrl || '',
                    _srcTexDataUrls: n._srcTexDataUrls ? n._srcTexDataUrls.map(function (item) { return { name: item.name, dataUrl: item.dataUrl }; }) : [],
                    _srcType: n._srcType || '',
                    _srcFileNames: n._srcFileNames ? n._srcFileNames.slice() : [],
                    _boneTags: n._boneTags ? JSON.parse(JSON.stringify(n._boneTags)) : {},
                    _boneNotes: n._boneNotes ? JSON.parse(JSON.stringify(n._boneNotes)) : {},
                    // 快照中将 shotId 转回 dataUrl，确保粘贴/克隆不依赖 _shotStore 生命周期
                    _boneScreenshots: n._boneScreenshots ? SMTool._serializeShots(n._boneScreenshots) : {},
                    _boneShotRefs: n._boneShotRefs ? JSON.parse(JSON.stringify(n._boneShotRefs)) : {},
                    _stateDesc: n._stateDesc || '',
                    _exitText: n._exitText || '',
                    _textContent: n._textContent || '',
                    _lineBreakPositions: n._lineBreakPositions ? n._lineBreakPositions.slice() : [],  // ★ 标题节点换行位置
                    _loopMode: n._loopMode || null,           // ★ 循环模式
                    _loopCount: n._loopCount !== undefined ? n._loopCount : 1,  // ★ 循环次数
                    _loopTime: n._loopTime !== undefined ? n._loopTime : null,  // ★ 循环时间
                    _customScale: n._customScale !== undefined ? n._customScale : 1.0,
                    infoCollapsed: !!n.infoCollapsed,
                    _oldId: n.id
                });
            });

            // 序列化选中节点之间的连线（两端都在选中集合内的连线）
            for (var i = 0; i < SMData.connections.length; i++) {
                var c = SMData.connections[i];
                if (selIds.has(c.fromNode) && selIds.has(c.toNode)) {
                    cb.connections.push({
                        fromNode: c.fromNode,
                        fromState: c.fromState,
                        toNode: c.toNode,
                        toState: c.toState,
                        condition: c.condition || '',
                        _mixDuration: SMTool._normalizeConnectionMixDuration ? SMTool._normalizeConnectionMixDuration(c._mixDuration) : (Number(c._mixDuration) || 0),
                        cp1x: c.cp1x !== undefined ? c.cp1x : 50,
                        cp1y: c.cp1y !== undefined ? c.cp1y : 0,
                        cp2x: c.cp2x !== undefined ? c.cp2x : -50,
                        cp2y: c.cp2y !== undefined ? c.cp2y : 0,
                        color: c.color || ''
                    });
                }
            }

            SMData._clipboard = cb;
            var msg = '已复制 ' + selIds.size + ' 个节点';
            if (cb.connections.length > 0) msg += ' + ' + cb.connections.length + ' 条连线';
            document.getElementById('sbStatus').textContent = msg;
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
        }
        e.preventDefault();
        return;
    }
    // Ctrl+V：粘贴剪贴板中的所有节点及连线
    if (e.ctrlKey && e.key === 'v') {
        var cb = SMData._clipboard;
        if (cb && cb.nodes && cb.nodes.length > 0) {
            SMTool.pushUndo();

            // 计算剪贴板节点的中心点
            var cx = 0, cy = 0;
            for (var i = 0; i < cb.nodes.length; i++) {
                cx += cb.nodes[i].x;
                cy += cb.nodes[i].y;
            }
            cx /= cb.nodes.length;
            cy /= cb.nodes.length;

            // 目标位置：鼠标所在世界坐标，偏移使中心对齐鼠标
            var wp = SMTool.canvasToWorld(SMData._mx || window.innerWidth / 2, SMData._my || window.innerHeight / 2);
            var offX = wp.x - cx;
            var offY = wp.y - cy;

            // 构建旧 ID → 新 ID 映射
            var idMap = {};
            var newSelIds = [];

            // 创建新节点
            for (var j = 0; j < cb.nodes.length; j++) {
                var nd = cb.nodes[j];
                var newId = SMData.nextId++;
                idMap[nd._oldId] = newId;

                var node = new SpineNodeData(newId);
                node.name = nd.name;
                node.nodeType = nd.nodeType;
                node.x = nd.x + offX;
                node.y = nd.y + offY;
                node.width = nd.width;
                node.sourceFile = nd.sourceFile;
                node.animations = nd.animations;
                node.skins = nd.skins;
                node.slots = nd.slots;
                node.bones = nd.bones;
                node.version = nd.version;
                node.currentAnim = nd.currentAnim;
                node.currentSkin = nd.currentSkin;
                node.premultipliedAlpha = nd.premultipliedAlpha;
                node.loop = nd.loop;
                node._srcSkelJson = nd._srcSkelJson;
                node._srcSkelBinBase64 = nd._srcSkelBinBase64;
                node._srcAtlasText = nd._srcAtlasText;
                node._srcTexDataUrl = nd._srcTexDataUrl;
                node._srcTexDataUrls = nd._srcTexDataUrls;
                node._srcType = nd._srcType;
                node._srcFileNames = nd._srcFileNames;
                node._boneTags = nd._boneTags;
                node._boneNotes = nd._boneNotes || {};
                node._boneScreenshots = nd._boneScreenshots || {};
                if (node._boneScreenshots) {
                    var bks = Object.keys(node._boneScreenshots);
                    for (var bk = 0; bk < bks.length; bk++) {
                        if (node._boneScreenshots[bks[bk]] && !Array.isArray(node._boneScreenshots[bks[bk]])) {
                            node._boneScreenshots[bks[bk]] = [node._boneScreenshots[bks[bk]]];
                        }
                        // 旧格式 dataUrl 字符串 → shotId
                        var sArr = node._boneScreenshots[bks[bk]];
                        if (Array.isArray(sArr)) {
                            for (var sii = 0; sii < sArr.length; sii++) {
                                if (typeof sArr[sii] === 'string' && sArr[sii].indexOf('data:image/') === 0) {
                                    sArr[sii] = SMData._shotRegister(sArr[sii]);
                                }
                            }
                        }
                    }
                }
                node._boneShotRefs = nd._boneShotRefs || {};
                node._stateDesc = nd._stateDesc;
                node._exitText = nd._exitText;
                node._textContent = nd._textContent;
                node._lineBreakPositions = nd._lineBreakPositions ? nd._lineBreakPositions.slice() : [];  // ★ 恢复标题节点换行位置
                node._loopMode = nd._loopMode || null;
                node._loopCount = (nd._loopCount !== undefined) ? nd._loopCount : 1;
                node._loopTime = (nd._loopTime !== undefined) ? nd._loopTime : null;
                node._customScale = nd._customScale !== undefined ? nd._customScale : 1.0;
                node.infoCollapsed = nd.infoCollapsed;

                SMData.nodes.set(newId, node);
                SMTool._createEl(node);
                SMTool._updatePos(node);

                // 异步加载 Spine 渲染数据
                if (node.nodeType === 'spine' &&
                    node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
                    (node._srcSkelJson || node._srcSkelBinBase64)) {
                    (function (n) {
                        SMTool._loadFromSourceData(n).then(function () {
                            SMTool._updateEl(n);
                            SMTool._updateDuplicateHighlights();
                            SMTool._checkMissingStates();
                            SMTool._refreshAllTranslations();
                            setTimeout(function () { SMTool._updateStateRowColors(); }, 150);
                        }).catch(function (err) {
                            console.error('[Paste] Failed to load Spine data for node #' + n.id + ':', err);
                        });
                    })(node);
                }

                newSelIds.push(newId);
            }

            // 创建连线（映射旧 ID 到新 ID）
            for (var k = 0; k < cb.connections.length; k++) {
                var cc = cb.connections[k];
                var newFrom = idMap[cc.fromNode];
                var newTo = idMap[cc.toNode];
                if (newFrom === undefined || newTo === undefined) continue; // 安全检查
                SMData.connections.push({
                    id: SMData.nextConnId++,
                    fromNode: newFrom,
                    fromState: cc.fromState,
                    toNode: newTo,
                    toState: cc.toState,
                    condition: cc.condition,
                    _mixDuration: SMTool._normalizeConnectionMixDuration ? SMTool._normalizeConnectionMixDuration(cc._mixDuration) : (Number(cc._mixDuration) || 0),
                    cp1x: cc.cp1x,
                    cp1y: cc.cp1y,
                    cp2x: cc.cp2x,
                    cp2y: cc.cp2y,
                    color: cc.color || _connColor(SMData.connections.length)
                });
            }

            // 选中所有新粘贴的节点
            SMData.selectedNodes.clear();
            for (var m = 0; m < newSelIds.length; m++) {
                SMData.selectedNodes.add(newSelIds[m]);
            }
            SMData.selectedNode = newSelIds[0] || null;
            SMData.selectedConnection = null;

            SMTool._updateSel();
            SMTool._updateSB();
            SMTool._updateStateRowColors();
            SMTool._updateDuplicateHighlights();
            SMTool._checkMissingStates();
            // ★ 即时刷新层级
            if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
            SMTool._refreshAllTranslations();

            var msg2 = '已粘贴 ' + newSelIds.length + ' 个节点';
            if (cb.connections.length > 0) msg2 += ' + ' + cb.connections.length + ' 条连线';
            document.getElementById('sbStatus').textContent = msg2;
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
            e.preventDefault();
            return;
        }
        // 没有节点剪贴板数据 → 不拦截，让 paste 事件正常触发（图片粘贴等）
        return;
    }
    if (e.key === 'Delete') {
        // 优先删除选中的连线
        if (SMData.selectedConnection) {
            SMTool.pushUndo();
            // 找到被删连线涉及的层级节点（用于刷新浮窗）
            var deletedConn = null;
            for (var dci = 0; dci < SMData.connections.length; dci++) {
                if (SMData.connections[dci].id === SMData.selectedConnection) { deletedConn = SMData.connections[dci]; break; }
            }
            SMData.connections = SMData.connections.filter(function (x) {
                return x.id !== SMData.selectedConnection;
            });
            SMData.selectedConnection = null;
            // ★ 立即刷新层级盒子文字
            if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
            // ★ 立即刷新对应层级浮窗
            if (deletedConn && deletedConn.fromNode) {
                var layerNode = SMData.nodes.get(deletedConn.fromNode);
                if (layerNode && layerNode.nodeType === 'layer' && typeof SMTool._refreshLayerPreviewIfOpen === 'function') {
                    SMTool._refreshLayerPreviewIfOpen(layerNode);
                }
            }
            SMTool._updateSB();
            SMTool._updateStateRowColors();
            SMTool._updateSel();
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
            SMTool.pushUndo();
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
    // Ctrl+S：导出保存（场景中有内容时才生效）
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (SMData.nodes.size > 0) {
            SMTool.exportData();
        }
        return;
    }
    // Ctrl+Z：撤销（排除文本输入框中的浏览器原生撤销）
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
        e.preventDefault();
        SMTool.undo();
        return;
    }
    // Ctrl+Alt+Z：重做
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        SMTool.redo();
        return;
    }
    if (e.key === 'Escape') {
        SMData.connecting = null;
        SMData.connectMode = false;
        SMData.selectedConnection = null;
        SMData.selectedNodes.clear();
        SMData.selectedNode = null;
        document.getElementById('btnConnect').classList.remove('active');
        document.getElementById('conditionEditor').classList.remove('show');
        // ★ 关闭预览面板
        SMTool._hideAnimPreview();
        SMTool._updateSel();
        SMTool._updateStateRowColors();
    }
};

// ---- 节点头部拖拽 ----
SMTool._onHD = function (e, nid) {
    // ★ 层拖拽排序激活时，禁止面板位移
    if (SMData._layerReorderActive) return;
    if (e.button === 1 || e.button === 2) {
        SMTool._onMD(e);
        return;
    }
    if (e.button !== 0) return;
    SMData._pendingDragSnap = SMTool._snapshotState();
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

// ---- 缩放图标拖拽开始 ----
SMTool._onScaleStart = function (e, nid) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    var node = SMData.nodes.get(nid);
    if (!node) return;
    SMData._pendingDragSnap = SMTool._snapshotState();
    SMData.scalingNode = {
        nodeId: nid,
        startScale: node._customScale || 1.0,
        startMx: e.clientX,
        startMy: e.clientY,
        startX: node.x,
        startY: node.y
    };
    SMTool.gridCanvas.style.cursor = 'nwse-resize';
};

// ---- 下拉框切换动画（track 0） ----
SMTool._onAnimChange = function (nid, animName) {
    SMTool.pushUndo();
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
    // 更新 track 0
    if (!node.tracks || node.tracks.length === 0) {
        SMTool._initDefaultTracks(node);
    }
    var oldAnim = node.tracks[0].animName;
    node.tracks[0].animName = animName;
    node.currentAnim = animName;
    node.name = SMTool._translateName(animName);

    // ★ 同轨切换: 使用 mixDuration 实现平滑过渡，不清除其他轨道
    var mixDur = (node.tracks[0].mixDuration !== undefined && node.tracks[0].mixDuration > 0)
        ? node.tracks[0].mixDuration : 0;
    if (oldAnim && oldAnim !== animName && mixDur > 0) {
        SMTool._setTrackMix(node, oldAnim, animName, mixDur);
        try { node.state.data.setMix(animName, oldAnim, mixDur); } catch(e) {}
    }

    // ★ 只切换 Track 0，保留其他轨道的播放状态
    var entry = node.state.setAnimation(0, animName, node.tracks[0].loop !== false);
    if (entry) {
        if (node.tracks[0].alpha !== undefined) entry.alpha = node.tracks[0].alpha;
        var is4x = (node._spineVer === '4.3' || node._spineVer === '4.2');
        if (is4x && node.tracks[0].mixBlend) entry.mixBlend = SMTool._mixBlendValue(node.tracks[0].mixBlend);
        if (mixDur > 0) entry.mixDuration = mixDur;
    }

    SMTool._updateEl(node);
    SMTool._updateStateRowColors();
    SMTool._updateDuplicateHighlights();
    SMTool._checkMissingStates();

    // ★ 同步更新预览面板（完整同步动画+PMA+皮肤）
    if (SMData._animPreview.visible && SMData._animPreview.nodeId === nid) {
        SMTool._updateAnimPreviewAnim(animName);
        SMTool._syncPreviewPmaAndSkin(SMData._animPreview, node);
    }
    // ★ 同步更新所有动画流路径中的状态名
    SMTool._syncFlowPathAnim(nid, animName);
    // ★ 同步更新层级节点的动画名
    if (typeof SMTool._syncLayerAnim === 'function') SMTool._syncLayerAnim(nid);
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
        if (!pos) return;
        var sp = SMTool.worldToCanvas(pos.x, pos.y);
        SMData.connecting = { nodeId: nid, stateName: name, sx: pos.x, sy: pos.y, mx: sp.x, my: sp.y };
        if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(nid);
        SMTool._updateSel();
    } else if (type === 'input' && SMData.connecting && SMData.connecting.nodeId !== nid) {
        // ★ 层级节点独占连线
        var fromNode = SMData.nodes.get(SMData.connecting.nodeId);
        if (fromNode && fromNode.nodeType === 'layer') {
            var layerFocusSource = SMData.connecting.nodeId;
            if (SMTool._tryConnectLayerDot(SMData.connecting.nodeId, SMData.connecting.stateName, nid)) {
                SMData.connectMode = false;
                document.getElementById('btnConnect').classList.remove('active');
                SMData.connecting = null;
                if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(layerFocusSource);
                SMTool._updateSel();
                SMTool._updateStateRowColors();
                return;
            }
        }
        // 快速连线（点击 input 圆点直接连）
        var directFocusSource3 = SMData.connecting.nodeId;
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
            SMTool.pushUndo();
            var fn = SMData.nodes.get(SMData.connecting.nodeId);
            var tn = SMData.nodes.get(nid);
            var fp = SMTool._getStateConnectorPos(fn, SMData.connecting.stateName, 'output');
            var tp = SMTool._getStateConnectorPos(tn, name, 'input');
            var def = fp && tp ? SMTool._defaultCPOffsets(fp, tp) : { cp1x: 50, cp1y: 0, cp2x: -50, cp2y: 0 };
            var colorIdx = SMData.connections.length;
            var newConn = {
                id: SMData.nextConnId++,
                fromNode: SMData.connecting.nodeId,
                fromState: SMData.connecting.stateName,
                toNode: nid,
                toState: name,
                condition: '',
                _mixDuration: 0,
                cp1x: def.cp1x, cp1y: def.cp1y,
                cp2x: def.cp2x, cp2y: def.cp2y,
                color: _connColor(colorIdx)
            };
            // ★ 检测是否为层级节点连线，补上 _layerNum
            var fn2 = SMData.nodes.get(newConn.fromNode);
            if (fn2 && fn2.nodeType === 'layer' && typeof newConn.fromState === 'string' && newConn.fromState.indexOf('layer_') === 0) {
                newConn._layerNum = parseInt(newConn.fromState.replace('layer_', '')) || 0;
                // 同步更新 _layerData
                var ld2 = SMTool._layerData(fn2);
                if (!ld2.layers) ld2.layers = {};
                ld2.layers[newConn._layerNum] = { animNodeId: newConn.toNode, animName: '' };
                var tn2 = SMData.nodes.get(newConn.toNode);
                if (tn2 && tn2.currentAnim) ld2.layers[newConn._layerNum].animName = tn2.currentAnim;
            }
            SMData.connections.push(newConn);
        }
        SMData.connecting = null;
        if (typeof SMTool._focusDirectSuccessors === 'function') SMTool._focusDirectSuccessors(directFocusSource3);
        // 清除连线状态残留
        var allDims2 = document.querySelectorAll('.spine-node .dim-overlay');
        for (var di3 = 0; di3 < allDims2.length; di3++) { allDims2[di3].remove(); }
        // ★ 立即刷新所有层级节点盒子文字
        if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
        // ★ 立即刷新对应层级的浮窗预览
        if (fn2 && fn2.nodeType === 'layer' && typeof SMTool._refreshLayerPreviewIfOpen === 'function') {
            SMTool._refreshLayerPreviewIfOpen(fn2);
        }
        SMTool._updateSel();
        SMTool._updateSB();
        SMTool._updateStateRowColors();
    }
};

// ---- 查找连线目标 ----
SMTool._inputStateForNode = function (node) {
    if (!node) return '';
    if (node.nodeType === 'exit') return 'exit';
    if (node.nodeType === 'entry') return 'entry';
    if (node.nodeType === 'layer') return 'layer';
    return node.currentAnim || '';
};

SMTool._findTarget = function (mx, my) {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var curState = SMTool._inputStateForNode(n);
        var worldPos = SMTool._getStateConnectorPos(n, curState, 'input');
        if (worldPos) {
            var screenPos = SMTool.worldToCanvas(worldPos.x, worldPos.y);
            var dx = mx - screenPos.x;
            var dy = my - screenPos.y;
            if (dx * dx + dy * dy < 576) {
                return { nodeId: n.id, stateName: curState, type: 'input' };
            }
        }
        result = nodesIter.next();
    }
    return null;
};

// ---- 高亮目标 ----
SMTool._setHighlightedTargetNode = function (nodeId) {
    if (SMTool._highlightedTargetNodeId === nodeId) return;
    function updateDot(id, active) {
        if (id === null || id === undefined) return;
        var el = SMTool._getEl(id);
        var dot = el ? el.querySelector('.anim-bar .conn-dot.input') : null;
        if (!dot) return;
        dot.style.transform = active ? 'scale(1.8)' : '';
        dot.style.background = active ? '#4a90d9' : '';
    }
    updateDot(SMTool._highlightedTargetNodeId, false);
    SMTool._highlightedTargetNodeId = nodeId;
    updateDot(nodeId, true);
};

SMTool._highlightTarget = function (mx, my) {
    var target = SMTool._findTarget(mx, my);
    SMTool._setHighlightedTargetNode(target ? target.nodeId : null);
};

// ---- 检测条件标签点击（也检测贝塞尔曲线上的点击） ----
SMTool._checkConditionClick = function (mx, my) {
    // ★ 优先检测删除按钮（×）：使用 _labelRects 中的 close 区域直接匹配
    if (SMData._labelRects) {
        for (var lri = 0; lri < SMData._labelRects.length; lri++) {
            var lr = SMData._labelRects[lri];
            if (lr.closeX !== undefined &&
                mx >= lr.closeX && mx <= lr.closeX + lr.closeW &&
                my >= lr.closeY && my <= lr.closeY + lr.closeH) {
                // 找到对应连线并清除条件
                for (var ciDel = 0; ciDel < SMData.connections.length; ciDel++) {
                    if (SMData.connections[ciDel].id === lr.connId) {
                        SMData.connections[ciDel].condition = '';
                        SMData.connections[ciDel]._hideLabel = true;
                        SMData.selectedConnection = null;
                        SMData._forceRedraw = true;
                        SMTool._updateSB();
                        SMTool._updateFlowPanel();
                        return true;
                    }
                }
            }
        }
    }

    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        var fn = SMData.nodes.get(c.fromNode);
        var tn = SMData.nodes.get(c.toNode);
        if (!fn || !tn) continue;

        // 入口/出口节点的连线不弹出条件编辑器
        var isEntryExitConn = (fn.nodeType === 'entry' || fn.nodeType === 'exit' || tn.nodeType === 'entry' || tn.nodeType === 'exit');

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

        // ★ 使用 _labelRects 精确检测：点击是否落在标签矩形内（不只是中点附近）
        var inLabelRect = false;
        if (SMData._labelRects) {
            for (var lrj = 0; lrj < SMData._labelRects.length; lrj++) {
                var lr2 = SMData._labelRects[lrj];
                if (lr2.connId === c.id &&
                    mx >= lr2.x && mx <= lr2.x + lr2.w &&
                    my >= lr2.y && my <= lr2.y + lr2.h) {
                    inLabelRect = true;
                    break;
                }
            }
        }

        // 检测是否点击了标签位置（中点附近，作为回退）
        var mt = 0.5;
        var lx = Math.pow(1 - mt, 3) * fs.x + 3 * Math.pow(1 - mt, 2) * mt * cp1s.x + 3 * (1 - mt) * mt * mt * cp2s.x + mt * mt * mt * ts.x;
        var ly = Math.pow(1 - mt, 3) * fs.y + 3 * Math.pow(1 - mt, 2) * mt * cp1s.y + 3 * (1 - mt) * mt * mt * cp2s.y + mt * mt * mt * ts.y;
        var distLabel = Math.sqrt((mx - lx) * (mx - lx) + (my - ly) * (my - ly));

        if (inLabelRect || distLabel < 30) {
            // ★ 单击：选中连线（用于贝塞尔拖拽），不弹条件编辑器
            SMData.selectedConnection = c.id;
            c._hideLabel = false;  // ★ 恢复标签显示
            SMTool._updateStateRowColors();
            // ★ 双击检测：同一连线短时间内再次点击 → 弹出条件编辑器
            var now2 = Date.now();
            if (SMData._lastCondClickConn === c.id && (now2 - SMData._lastCondClickTime) < 450) {
                SMData._lastCondClickConn = -1;
                if (!isEntryExitConn) {
                    var boxBottom = ly;
                    if (SMData._labelRects) {
                        for (var lri = 0; lri < SMData._labelRects.length; lri++) {
                            if (SMData._labelRects[lri].connId === c.id) {
                                boxBottom = SMData._labelRects[lri].y + SMData._labelRects[lri].h;
                                break;
                            }
                        }
                    }
                    SMTool._showCond(c, lx, boxBottom);
                }
            } else {
                SMData._lastCondClickConn = c.id;
                SMData._lastCondClickTime = now2;
            }
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
SMTool._showCond = function (conn, centerX, boxBottom) {
    var ed = document.getElementById('conditionEditor');
    ed.classList.add('show');
    // ★ 水平居中于条件框，垂直紧贴条件框底部 + 10px
    var edW = ed.offsetWidth || 260;
    ed.style.left = (centerX - edW / 2) + 'px';
    ed.style.top = (boxBottom + 10) + 'px';
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
        // ★ 清除所有动态元素（空白区域右键残留的分割线、文本节点、取组分隔等）
        menu.querySelectorAll('.ctx-text-node, .ctx-sep-dyn, .ctx-ungroup').forEach(function (el) { el.remove(); });
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
        // 空白区域右键菜单：创建各种节点
        var menu3 = document.getElementById('ctxMenu');
        // ★ 清除所有动态添加的元素（每次右键重新构建，避免分割线等累积撑高面板）
        menu3.querySelectorAll('.ctx-text-node, .ctx-sep-dyn, .ctx-ungroup').forEach(function (el) { el.remove(); });
        var item0a = document.createElement('div');
        item0a.className = 'ctx-item ctx-text-node';
        item0a.textContent = '🚪 添加入口节点';
        item0a.onclick = function () { SMTool.addEntryNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0a);
        var item0b = document.createElement('div');
        item0b.className = 'ctx-item ctx-text-node';
        item0b.textContent = '🏁 添加出口节点';
        item0b.onclick = function () { SMTool.addExitNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0b);
        var item0c = document.createElement('div');
        item0c.className = 'ctx-item ctx-text-node';
        item0c.textContent = '📚 添加层级节点';
        item0c.onclick = function () { SMTool.addLayerNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0c);
        var item0d = document.createElement('div');
        item0d.className = 'ctx-item ctx-text-node';
        item0d.textContent = '⏱ 添加模拟延时器';
        item0d.onclick = function () { SMTool.addDelayerNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0d);
        var item0d2 = document.createElement('div');
        item0d2.className = 'ctx-item ctx-text-node';
        item0d2.textContent = '⏱ 添加程序延时器';
        item0d2.onclick = function () { SMTool.addProgDelayerNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0d2);
        var item0e = document.createElement('div');
        item0e.className = 'ctx-item ctx-text-node';
        item0e.textContent = '🙈 添加隐藏器节点';
        item0e.onclick = function () { SMTool.addHiderNodeAt(wp.x, wp.y); menu3.style.display = 'none'; };
        menu3.appendChild(item0e);
        var sep0 = document.createElement('div');
        sep0.className = 'ctx-sep ctx-sep-dyn';
        sep0.style.cssText = 'height:1px;background:var(--border);margin:4px 8px';
        menu3.appendChild(sep0);
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
        // ★ 面板刚由指示器展开时的首次 enter 不清除指示器模式，但清除标志允许后续 enter 生效
        if (SMData._floatPanel._indicatorJustOpened) {
            SMData._floatPanel._indicatorJustOpened = false;
        } else {
            SMData._floatPanel._indicatorMode = false;
            if (SMTool._indicatorAutoCloseTimer) { clearTimeout(SMTool._indicatorAutoCloseTimer); SMTool._indicatorAutoCloseTimer = null; }
        }
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

    // ★ 点击数据面板内任意子项或聚焦文本框 → 自动设为粘贴目标，无需先点「📋 粘贴截图」
    function _setPasteTargetFromEl(el) {
        var noteArea = el.closest && el.closest('[data-bone-note]');
        if (!noteArea) return;
        var name = noteArea.getAttribute('data-bone-note');
        if (!name) return;
        var selNode = SMData.nodes.get(SMData.selectedNode);
        var type = 'bone';
        if (selNode && selNode.nodeType === 'spine') {
            if (selNode.skins && selNode.skins.indexOf(name) >= 0) type = 'skin';
            else if (selNode.slots && selNode.slots.indexOf(name) >= 0) type = 'slot';
            else if (selNode._eventScreenshots && selNode._eventScreenshots.hasOwnProperty(name)) type = 'event';
        }
        SMData._pasteTargetBone = name;
        SMData._pasteTargetType = type;
    }

    // focusin：聚焦到备注框时自动记录
    panel.addEventListener('focusin', function (e) {
        _setPasteTargetFromEl(e.target);
    });

    // click：点击子项行头/截图区等非文本框区域时也自动记录
    panel.addEventListener('click', function (e) {
        // 不拦截按钮点击（选取图片、粘贴截图等已有自己的逻辑）
        if (e.target.closest && e.target.closest('button, .dfp-shot-del')) return;
        _setPasteTargetFromEl(e.target);
    });

    // 全局鼠标移动 — 检测靠近左边缘
    document.addEventListener('mousemove', function (e) {
        if (SMData._floatPanel.pinned || SMData._floatPanel.expanded) return;
        // 全屏截图模式时不触发面板展开
        var shotOverlay = document.getElementById('screenshotOverlay');
        if (shotOverlay && shotOverlay.classList.contains('show')) return;
        if (e.clientX <= 15) {
            SMTool._expandFloatPanel();
        }
    });

    // 全局鼠标移动 — 检测是否远离面板（50px 阈值）
    document.addEventListener('mousemove', function (e) {
        if (SMData._floatPanel.pinned) return;
        if (!SMData._floatPanel.expanded) return;
        // ★ 指示器模式中不收起
        if (SMData._floatPanel._indicatorMode || SMData._floatPanel._indicatorJustOpened) return;

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
    // ★ 面板收起时清除所有粘贴目标，后续 Ctrl+V 走节点面板路径
    SMData._pasteTargetBone = null;
    SMData._pasteTargetType = 'bone';
    SMData._lastPanelFocusName = null;
};

// 延迟收起（鼠标离开面板时使用，留一点缓冲）
SMTool._scheduleFloatPanelCollapse = function (e) {
    // 清除之前的定时器
    if (SMData._floatPanel._collapseTimer) {
        clearTimeout(SMData._floatPanel._collapseTimer);
    }
    SMData._floatPanel._collapseTimer = setTimeout(function () {
        // ★ 指示器模式中不收起（等5s超时或鼠标主动进入后面板）
        if (SMData._floatPanel._indicatorMode || SMData._floatPanel._indicatorJustOpened) return;
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
// 底部动画组合浮窗面板交互 — 边缘检测 / 铆钉 / 离开收起 / 最大化
// ================================================================
SMTool._syncThreeFlowConditionText = function (connId, value) {
    var nextValue = String(value || '').trim();
    var fields = document.querySelectorAll('[data-flow-condition-conn="' + connId + '"]');
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        field.contentEditable = 'false';
        field.classList.remove('editing');
        field.classList.toggle('flp-condition', !!nextValue);
        field.classList.toggle('flp-condition-empty', !nextValue);
        field.textContent = nextValue ? '条件：' + nextValue : '条件：（空）';
        field.title = '双击修改条件';
    }
};

SMTool._commitThreeFlowCondition = function (connId, rawValue) {
    var conn = null;
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === connId) { conn = SMData.connections[i]; break; }
    }
    if (!conn) return null;
    var nextValue = String(rawValue || '').trim();
    if ((conn.condition || '') !== nextValue) {
        if (typeof SMTool.pushUndo === 'function') SMTool.pushUndo();
        conn.condition = nextValue;
        // 从三层流程主动编辑条件时，画布上的关联条件框必须重新显示并同步内容。
        conn._hideLabel = false;
        SMData._forceRedraw = true;
    }
    SMTool._syncThreeFlowConditionText(connId, nextValue);
    // 当前三层列表已做局部同步，避免条件修改后触发整张流程列表重建。
    if (typeof SMTool._flowPanelPassiveKey === 'function') {
        SMData._lastPassiveFlowPanelKey = SMTool._flowPanelPassiveKey();
    }
    return nextValue;
};

SMTool._beginThreeFlowConditionEdit = function (event, element) {
    if (!element || element.classList.contains('editing')) return;
    event.preventDefault();
    event.stopPropagation();
    var connId = parseInt(element.getAttribute('data-flow-condition-conn'));
    var conn = null;
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === connId) { conn = SMData.connections[i]; break; }
    }
    if (!conn) return;

    var original = conn.condition || '';
    var finished = false;
    element.textContent = original;
    element.contentEditable = 'true';
    element.classList.add('editing');
    element.focus();
    try { document.execCommand('selectAll'); } catch (ignore) {}

    var finish = function (cancelled) {
        if (finished) return;
        finished = true;
        element.removeEventListener('blur', onBlur);
        element.removeEventListener('keydown', onKeyDown);
        element.contentEditable = 'false';
        if (cancelled) SMTool._syncThreeFlowConditionText(connId, original);
        else SMTool._commitThreeFlowCondition(connId, element.innerText || element.textContent || '');
    };
    var onBlur = function () { finish(false); };
    var onKeyDown = function (keyEvent) {
        keyEvent.stopPropagation();
        if (keyEvent.key === 'Enter') {
            keyEvent.preventDefault();
            element.blur();
        } else if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            finish(true);
            element.blur();
        }
    };
    element.addEventListener('blur', onBlur);
    element.addEventListener('keydown', onKeyDown);
};

SMTool._initFlowPanel = function () {
    var panel = document.getElementById('flowPanel');
    var pinBtn = panel.querySelector('.flp-pin');
    var maxBtn = panel.querySelector('.flp-maximize');
    var triggerBar = panel.querySelector('.flp-trigger-bar');
    var body = panel.querySelector('.flp-body');

    function onPanelAreaEnter() {
        SMData._flowPanel.hovered = true;
        SMData._flowPanel._justUnmaximized = false;
        if (SMData._flowPanel._collapseTimer) {
            clearTimeout(SMData._flowPanel._collapseTimer);
            SMData._flowPanel._collapseTimer = null;
        }
        if (!SMData._flowPanel.expanded) {
            SMTool._expandFlowPanel();
        }
    }
    function onPanelAreaLeave(e) {
        SMData._flowPanel.hovered = false;
        SMTool._scheduleFlowPanelCollapse(e);
    }

    triggerBar.addEventListener('mouseenter', onPanelAreaEnter);
    triggerBar.addEventListener('mouseleave', onPanelAreaLeave);
    body.addEventListener('mouseenter', onPanelAreaEnter);
    body.addEventListener('mouseleave', onPanelAreaLeave);

    // 点击铆钉图标切换固定状态
    pinBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        SMData._flowPanel.pinned = !SMData._flowPanel.pinned;
        if (SMData._flowPanel.pinned) {
            pinBtn.classList.add('active');
            pinBtn.title = '取消固定';
            panel.classList.add('pinned');
        } else {
            pinBtn.classList.remove('active');
            pinBtn.title = '固定面板';
            panel.classList.remove('pinned');
        }
    });

    // 点击最大化按钮切换面板高度
    maxBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (SMData._flowPanel.maximized) {
            // 当前全屏 → 还原
            if (!SMData._flowPanel.pinned) {
                // 未锚定：直接完全收起到底部
                SMTool._collapseFlowPanel();
            } else {
                // 已锚定：还原到短屏 300px
                SMData._flowPanel.maximized = false;
                panel.classList.remove('maximized');
                maxBtn.innerHTML = '▲';
                maxBtn.title = '最大化面板';
                SMData._flowPanel._justUnmaximized = true;
            }
        } else {
            // 当前短屏 → 全屏
            SMData._flowPanel.maximized = true;
            panel.classList.add('maximized');
            maxBtn.innerHTML = '▼';
            maxBtn.title = '还原面板';
        }
    });

    // 点击触发器条也能展开/收起（锚钉激活时不可收起）
    triggerBar.addEventListener('click', function (e) {
        e.stopPropagation();
        if (SMData._flowPanel.expanded) {
            if (!SMData._flowPanel.pinned) {
                SMTool._collapseFlowPanel();
            }
        } else {
            SMTool._expandFlowPanel();
        }
    });

    // 全局鼠标移动 — 检测靠近底部边缘
    document.addEventListener('mousemove', function (e) {
        if (SMData._flowPanel.pinned || SMData._flowPanel.expanded) return;
        // 全屏截图模式时不触发面板展开
        var shotOverlay = document.getElementById('screenshotOverlay');
        if (shotOverlay && shotOverlay.classList.contains('show')) return;
        if (e.clientY >= window.innerHeight - 65) {
            SMTool._expandFlowPanel();
        }
    });

    // 全局鼠标移动 — 检测是否远离面板（50px 阈值，全屏时不触发自动收起）
    document.addEventListener('mousemove', function (e) {
        if (SMData._flowPanel.pinned) return;
        if (SMData._flowPanel.maximized) return;
        if (SMData._flowPanel._justUnmaximized) return;
        if (!SMData._flowPanel.expanded) return;
        var rect = panel.getBoundingClientRect();
        if (e.clientY < rect.top - 50 || e.clientY > rect.bottom + 50) {
            SMTool._collapseFlowPanel();
        }
    });

    // 全局点击 — 面板外点击：先取消动画组选中，再处理收起
    document.addEventListener('mousedown', function (e) {
        if (!SMData._flowPanel.expanded) return;
        // 检查点击是否在面板内部
        if (e.target.closest && e.target.closest('#flowPanel')) return;

        // 仅左键(0)和右键(2)点击时取消动画组选中，中键(1)拖拽画布时不管
        if (e.button === 0 || e.button === 2) {
            if (SMData._fullPlayback.activePathIdx >= 0) {
                SMData._fullPlayback.activePathIdx = -1;
                SMData._fullPlayback.currentStep = 0;
                SMData._fullPlayback.isPlaying = false;
                if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
                SMTool._clearAllProgressBars();
                SMTool._resumeAllNodes();
                SMData._flowFocus = null;
                SMTool._updateFlowPanel();
                SMTool._updateSel();
                SMTool._updateStateRowColors();
            }
        }

        if (SMData._flowPanel.maximized) {
            if (SMData._flowPanel.pinned) {
                // 全屏+已锚定：面板外点击 → 还原到短屏（300px）
                SMTool._unmaximizeFlowPanel();
            } else {
                // 全屏+未锚定：面板外点击 → 完全收起
                SMTool._collapseFlowPanel();
            }
        } else if (!SMData._flowPanel.pinned) {
            // 短屏未锚定：面板外点击 → 收起
            SMTool._collapseFlowPanel();
        }
        // 短屏已锚定：不收起
    });

    // 面板内容区滚轮事件 — 阻止冒泡到画布（避免缩放）
    body.addEventListener('wheel', function (e) {
        e.stopPropagation();
    });

    // 流程链行点击 — 高亮对应节点和连线
    var flpContent = document.getElementById('flpContent');
    if (flpContent) {
        flpContent.addEventListener('dblclick', function (e) {
            var condition = e.target.closest('[data-flow-condition-conn]');
            if (!condition) return;
            SMTool._beginThreeFlowConditionEdit(e, condition);
        });
        flpContent.addEventListener('click', function (e) {
            // 条件文本由双击编辑处理，单击不切换整条流程的选中状态。
            if (e.target.closest('[data-flow-condition-conn]')) {
                e.stopPropagation();
                return;
            }
            var row = e.target.closest('.flp-chain-row');
            if (!row) return;
            e.stopPropagation();

            var nodesStr = row.getAttribute('data-flow-nodes');
            var connsStr = row.getAttribute('data-flow-conns');
            if (!nodesStr || !connsStr) return;

            // 切换：如果已激活则取消高亮
            if (row.classList.contains('active')) {
                row.classList.remove('active');
                SMData._flowFocus = null;
            } else {
                // 取消其他行的激活状态
                var allRows = flpContent.querySelectorAll('.flp-chain-row');
                for (var ri = 0; ri < allRows.length; ri++) {
                    allRows[ri].classList.remove('active');
                }
                row.classList.add('active');

                // 设置流程焦点
                var nodeIdArr = nodesStr.split(',');
                var connIdArr = connsStr.split(',');
                var nodeIds = new Set();
                var connIds = new Set();
                for (var ni = 0; ni < nodeIdArr.length; ni++) {
                    nodeIds.add(parseInt(nodeIdArr[ni]));
                }
                for (var ci = 0; ci < connIdArr.length; ci++) {
                    connIds.add(parseInt(connIdArr[ci]));
                }
                SMData._flowFocus = { nodeIds: nodeIds, connIds: connIds };
            }
            SMTool._updateSel();
            SMTool._updateStateRowColors();

            // ★ 触发右上角动画预览浮窗
            if (SMData.selectedNode) {
                var selNode2 = SMData.nodes.get(SMData.selectedNode);
                if (selNode2) SMTool._showAnimPreview(selNode2);
            }
        });
    }
};

// 展开底部流程面板
SMTool._expandFlowPanel = function () {
    if (SMData._flowPanel.expanded) return;
    SMData._flowPanel.expanded = true;
    var panel = document.getElementById('flowPanel');
    if (panel) panel.classList.add('expanded');
    // 先展开外壳让画面响应，路径整理在空闲帧完成；完成后再按原规则自动高亮第一条路径。
    SMData._flowPanelAutoSelectPending = !!SMData.selectedNode;
    SMTool._scheduleFlowPanelUpdate({ force: true });
};

// ================================================================
// 🔒🔒🔒 [LOCK-5] 展开/收起底部动画组合面板
// ⚠️ 解锁策略：仅用户明确说「解锁 LOCK-5」才能改！
//
// 核心规则（详见各函数内注释）：
//   - 无选中节点时面板纯视觉，不碰任何动画
//   - 选中节点 + 展开 → 仅高亮路径，不打断动画
//   - 只有点击播放/导航按钮才暂停
//   - 播放/导航后退出（画布点击/面板收起）才恢复
// ================================================================

// 展开底部流程面板
SMTool._expandFlowPanel = function () {
    if (SMData._flowPanel.expanded) return;
    SMData._flowPanel.expanded = true;
    var panel = document.getElementById('flowPanel');
    if (panel) panel.classList.add('expanded');
    // ★ [LOCK-5] 保持“仅高亮、不暂停”的语义，但把昂贵的数据整理移到画布完成本帧之后。
    SMData._flowPanelAutoSelectPending = !!SMData.selectedNode;
    SMTool._scheduleFlowPanelUpdate({ force: true });
};

// 收起底部流程面板
SMTool._collapseFlowPanel = function () {
    if (!SMData._flowPanel.expanded) return;
    SMData._flowPanel.expanded = false;
    var panel = document.getElementById('flowPanel');
    // ★ [LOCK-5] 无选中节点 → 仅收起面板，不碰动画
    if (!SMData.selectedNode) {
        if (panel) { panel.classList.remove('expanded'); panel.classList.remove('maximized'); }
        return;
    }
    // ★ [LOCK-5] 仅当真正播放/导航过才恢复动画
    //   判断依据：isPlaying（点了播放）或 _stepped（点了上一步/下一步）
    //   仅选中路径但未播放 → hadFlowActive=false → 不恢复（没打断过所以无需恢复）
    var pb = SMData._fullPlayback;
    var hadFlowActive = pb.isPlaying || pb._stepped;
    SMData._flowPanel.maximized = false;
    SMData._flowFocus = null;
    SMData._fullPlayback.isPlaying = false;
    SMData._fullPlayback.activePathIdx = -1;
    SMData._fullPlayback.currentStep = 0;
    if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
    SMTool._clearAllProgressBars();
    // ★ 流播放退出必须用 _forceResetAllNodes（clearTracks 后的轨道无法仅靠解冻恢复）
    if (hadFlowActive) {
        SMTool._forceResetAllNodes();
    }
    SMTool._updateSel();
    SMTool._updateStateRowColors();
    if (panel) {
        panel.classList.remove('expanded');
        panel.classList.remove('maximized');
        var maxBtn = panel.querySelector('.flp-maximize');
        if (maxBtn) {
            maxBtn.innerHTML = '▲';
            maxBtn.title = '最大化面板';
        }
    }
};

// 从全屏还原到短屏（不收起面板）
SMTool._unmaximizeFlowPanel = function () {
    if (!SMData._flowPanel.maximized) return;
    SMData._flowPanel.maximized = false;
    var panel = document.getElementById('flowPanel');
    if (panel) {
        panel.classList.remove('maximized');
        var maxBtn = panel.querySelector('.flp-maximize');
        if (maxBtn) {
            maxBtn.innerHTML = '▲';
            maxBtn.title = '最大化面板';
        }
    }
    // 面板缩小中，鼠标可能落在面板外 → 阻止自动收起，等鼠标重新进入面板再恢复
    SMData._flowPanel._justUnmaximized = true;
};

// 延迟收起底部流程面板
SMTool._scheduleFlowPanelCollapse = function (e) {
    if (SMData._flowPanel._collapseTimer) {
        clearTimeout(SMData._flowPanel._collapseTimer);
    }
    SMData._flowPanel._collapseTimer = setTimeout(function () {
        if (!SMData._flowPanel.hovered && !SMData._flowPanel.pinned && !SMData._flowPanel.maximized && !SMData._flowPanel._justUnmaximized) {
            var panel = document.getElementById('flowPanel');
            if (panel) {
                var rect = panel.getBoundingClientRect();
                var my = SMData._my || 0;
                if (my < rect.top - 50 || my > rect.bottom) {
                    SMTool._collapseFlowPanel();
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
        // 骨骼标记按钮（+）
        var tagBtn = e.target.closest('.dfp-bone-mark');
        if (tagBtn) {
            e.stopPropagation();
            var boneName = tagBtn.getAttribute('data-bone');
            // 设为此骨骼为粘贴目标
            SMData._pasteTargetBone = boneName;
            SMTool._toggleBoneTag(boneName);
            return;
        }

        // 点击骨骼行 → 设为此骨骼为粘贴目标
        var boneRow = e.target.closest('.dfp-bone-row');
        if (boneRow) {
            var boneName = boneRow.getAttribute('data-bone');
            if (boneName) SMData._pasteTargetBone = boneName;
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

    SMData._lastPanelNodeId = -1;
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

    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};
