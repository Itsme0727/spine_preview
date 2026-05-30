/* ================================================================
   UI/DOM 操作 — 节点 DOM 创建、更新、状态行颜色等
   负责: 创建/更新/删除 Spine 节点的 HTML DOM 元素、面板管理
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 创建节点 DOM ----
SMTool._createEl = function (node) {
    var el = document.createElement('div');
    el.className = 'spine-node';
    el.id = 'sn-' + node.id;
    el.style.minWidth = '260px';

    var rowsHtml = '';
    for (var i = 0; i < node.animations.length; i++) {
        var a = node.animations[i];
        var aname = SMTool._esc(a.name);
        rowsHtml += '<div class="state-row" data-state="' + aname + '" onclick="SMTool._onStateClick(' + node.id + ',\'' + aname + '\')">' +
            '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + aname + '\',\'input\')"></div>' +
            '<span style="flex:1;text-align:center">' + aname + '</span>' +
            '<span class="state-dur">' + a.duration.toFixed(2) + 's</span>' +
            '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + aname + '\',\'output\')"></div>' +
            '</div>';
    }

    var skinsHtml = '';
    for (var si = 0; si < node.skins.length; si++) {
        skinsHtml += '<span class="badge">' + SMTool._esc(node.skins[si]) + '</span>';
    }
    if (!skinsHtml) skinsHtml = '<span class="badge">无皮肤</span>';

    var animsHtml = '';
    for (var ai = 0; ai < node.animations.length; ai++) {
        var aa = node.animations[ai];
        animsHtml += '<div class="ip-row"><span>' + SMTool._esc(aa.name) + '</span><span>' + aa.duration.toFixed(2) + 's</span></div>';
    }
    if (!animsHtml) animsHtml = '<div class="ip-row">无</div>';

    var skinRows = '';
    for (var si2 = 0; si2 < node.skins.length; si2++) {
        skinRows += '<div class="ip-row">' + SMTool._esc(node.skins[si2]) + '</div>';
    }
    if (!skinRows) skinRows = '<div class="ip-row">default</div>';

    var boneRows = '';
    for (var bi = 0; bi < node.bones.length; bi++) {
        boneRows += '<div class="ip-row">' + SMTool._esc(node.bones[bi]) + '</div>';
    }
    if (!boneRows) boneRows = '<div class="ip-row">无</div>';

    var slotRows = '';
    for (var sli = 0; sli < node.slots.length; sli++) {
        slotRows += '<div class="ip-row">' + SMTool._esc(node.slots[sli]) + '</div>';
    }
    if (!slotRows) slotRows = '<div class="ip-row">无</div>';

    el.innerHTML =
        '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
            '<span class="name">' + SMTool._esc(node.name) + '</span>' +
            '<div class="btns">' +
                '<button onclick="event.stopPropagation();SMTool.toggleInfoPanel(' + node.id + ')">ℹ️</button>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="spine-canvas-wrap" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._onND(event,' + node.id + ')">' +
            '<div style="color:var(--text2);padding:40px">拖入 Spine 文件</div>' +
        '</div>' +
        '<div class="state-list">' + (rowsHtml || '<div style="color:var(--text2);text-align:center;padding:8px">暂无动画</div>') + '</div>' +
        '<div class="footer">' + skinsHtml + '<span class="badge" style="margin-left:auto">v' + SMTool._esc(node.version || '?') + '</span></div>' +
        '<div class="info-panel" id="info-' + node.id + '">' +
            '<div class="ip-header" onclick="SMTool.toggleInfoPanel(' + node.id + ')">📋 动画数据</div>' +
            '<div class="ip-body">' +
                '<div class="ip-section"><div class="ip-title">📦 Spine 版本</div><div class="ip-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>' +
                '<div class="ip-section"><div class="ip-title">🎬 动画 (' + node.animations.length + ')</div>' + animsHtml + '</div>' +
                '<div class="ip-section"><div class="ip-title">🎨 皮肤 (' + node.skins.length + ')</div>' + skinRows + '</div>' +
                '<div class="ip-section"><div class="ip-title">🦴 骨骼 (' + node.bones.length + ')</div>' + boneRows + '</div>' +
                '<div class="ip-section"><div class="ip-title">🔧 插槽 (' + node.slots.length + ')</div>' + slotRows + '</div>' +
                '<div class="ip-section"><div class="checkbox-row"><input type="checkbox" id="pma-' + node.id + '" ' + (node.premultipliedAlpha ? 'checked' : '') + ' onchange="SMTool._togglePMA(' + node.id + ',this.checked)"><label>预乘 Alpha 通道</label></div></div>' +
            '</div>' +
        '</div>';

    SMTool.nodesLayer.appendChild(el);
};

// ---- 更新节点 DOM ----
SMTool._updateEl = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;

    // 状态列表
    var sl = el.querySelector('.state-list');
    if (sl) {
        var rowsHtml = '';
        for (var i = 0; i < node.animations.length; i++) {
            var a = node.animations[i];
            var act = node.currentAnim === a.name;
            var aname = SMTool._esc(a.name);
            rowsHtml += '<div class="state-row' + (act ? ' active' : '') + '" data-state="' + aname + '" onclick="SMTool._onStateClick(' + node.id + ',\'' + aname + '\')">' +
                '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + aname + '\',\'input\')"></div>' +
                '<span style="flex:1;text-align:center">' + aname + '</span>' +
                '<span class="state-dur">' + a.duration.toFixed(2) + 's</span>' +
                '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + aname + '\',\'output\')"></div>' +
                '</div>';
        }
        sl.innerHTML = rowsHtml || '<div style="color:var(--text2);text-align:center;padding:8px">暂无动画</div>';
    }

    // 底部信息
    var ft = el.querySelector('.footer');
    if (ft) {
        var skinsHtml = '';
        for (var si = 0; si < node.skins.length; si++) {
            skinsHtml += '<span class="badge">' + SMTool._esc(node.skins[si]) + '</span>';
        }
        ft.innerHTML = (skinsHtml || '<span class="badge">无皮肤</span>') + '<span class="badge" style="margin-left:auto">v' + SMTool._esc(node.version || '?') + '</span>';
    }

    // 标题
    var hn = el.querySelector('.header .name');
    if (hn) { hn.textContent = node.name; hn.title = node.name; }

    // PMA 勾选框
    var cb = el.querySelector('#pma-' + node.id);
    if (cb) cb.checked = node.premultipliedAlpha;

    // 信息面板
    var ip = el.querySelector('#info-' + node.id + ' .ip-body');
    if (ip) {
        var animsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var aa = node.animations[ai];
            animsHtml += '<div class="ip-row"><span>' + SMTool._esc(aa.name) + '</span><span>' + aa.duration.toFixed(2) + 's</span></div>';
        }
        var skinRows = '';
        for (var si2 = 0; si2 < node.skins.length; si2++) {
            skinRows += '<div class="ip-row">' + SMTool._esc(node.skins[si2]) + '</div>';
        }
        var boneRows = '';
        for (var bi = 0; bi < node.bones.length; bi++) {
            boneRows += '<div class="ip-row">' + SMTool._esc(node.bones[bi]) + '</div>';
        }
        var slotRows = '';
        for (var sli = 0; sli < node.slots.length; sli++) {
            slotRows += '<div class="ip-row">' + SMTool._esc(node.slots[sli]) + '</div>';
        }
        ip.innerHTML =
            '<div class="ip-section"><div class="ip-title">📦 Spine 版本</div><div class="ip-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>' +
            '<div class="ip-section"><div class="ip-title">🎬 动画 (' + node.animations.length + ')</div>' + (animsHtml || '<div class="ip-row">无</div>') + '</div>' +
            '<div class="ip-section"><div class="ip-title">🎨 皮肤 (' + node.skins.length + ')</div>' + (skinRows || '<div class="ip-row">default</div>') + '</div>' +
            '<div class="ip-section"><div class="ip-title">🦴 骨骼 (' + node.bones.length + ')</div>' + (boneRows || '<div class="ip-row">无</div>') + '</div>' +
            '<div class="ip-section"><div class="ip-title">🔧 插槽 (' + node.slots.length + ')</div>' + (slotRows || '<div class="ip-row">无</div>') + '</div>' +
            '<div class="ip-section"><div class="checkbox-row"><input type="checkbox" id="pma-' + node.id + '" ' + (node.premultipliedAlpha ? 'checked' : '') + ' onchange="SMTool._togglePMA(' + node.id + ',this.checked)"><label>预乘 Alpha 通道</label></div></div>';
    }
};

// ---- 获取节点 DOM 元素 ----
SMTool._getEl = function (id) {
    return document.getElementById('sn-' + id);
};

// ---- 更新节点位置 ----
SMTool._updatePos = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    var s = SMTool.worldToDOM(node.x, node.y);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.transform = 'scale(' + SMData.view.zoom + ')';
    el.style.transformOrigin = 'top left';
};

SMTool._updateAllPos = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        SMTool._updatePos(result.value);
        result = nodesIter.next();
    }
};

// ---- 更新选中状态 ----
SMTool._updateSel = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            el.classList.toggle('selected', n.id === SMData.selectedNode);
            if (SMData.connecting && SMData.connecting.nodeId === n.id) {
                el.classList.add('connecting');
            } else {
                el.classList.remove('connecting');
            }
        }
        result = nodesIter.next();
    }
};

// ---- 更新状态栏 ----
SMTool._updateSB = function () {
    document.getElementById('sbNodes').textContent = '节点: ' + SMData.nodes.size;
    document.getElementById('sbConns').textContent = '连线: ' + SMData.connections.length;
};

// ---- 更新状态行颜色（按参与连线着色） ----
SMTool._updateStateRowColors = function () {
    var stateColors = new Map();

    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        var color = c.color || _connColor(i);
        var isSel = SMData.selectedConnection === c.id;
        var alpha = isSel ? '' : '44';

        // 来源状态
        if (!stateColors.has(c.fromNode)) stateColors.set(c.fromNode, new Map());
        var fromMap = stateColors.get(c.fromNode);
        if (!fromMap.has(c.fromState)) fromMap.set(c.fromState, []);
        fromMap.get(c.fromState).push({ color: color, alpha: alpha, isSel: isSel });

        // 目标状态
        if (!stateColors.has(c.toNode)) stateColors.set(c.toNode, new Map());
        var toMap = stateColors.get(c.toNode);
        if (!toMap.has(c.toState)) toMap.set(c.toState, []);
        toMap.get(c.toState).push({ color: color, alpha: alpha, isSel: isSel });
    }

    // 应用到 DOM
    var stateEntriesIter = stateColors.entries();
    var seResult = stateEntriesIter.next();
    while (!seResult.done) {
        var nid = seResult.value[0];
        var stateMap = seResult.value[1];
        var el = SMTool._getEl(nid);
        if (el) {
            var rows = el.querySelectorAll('.state-row');
            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var sname = row.dataset.state;
                var infos = stateMap.get(sname);
                if (infos && infos.length > 0) {
                    var info = infos[0];
                    row.style.backgroundColor = info.color + info.alpha;
                    row.style.borderLeft = '3px solid ' + info.color;
                    if (info.isSel) {
                        row.style.color = '#fff';
                        row.style.fontWeight = 'bold';
                    }
                } else {
                    row.style.backgroundColor = '';
                    row.style.borderLeft = '';
                    row.style.color = '';
                    row.style.fontWeight = '';
                }
            }
        }
        seResult = stateEntriesIter.next();
    }
};

// ---- 信息面板 ----
SMTool.toggleInfoPanel = function (nid) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    node.infoCollapsed = !node.infoCollapsed;
    var panel = document.getElementById('info-' + nid);
    if (panel) panel.classList.toggle('show', !node.infoCollapsed);
};

// ---- PMA 切换 ----
SMTool._togglePMA = function (nid, v) {
    var node = SMData.nodes.get(nid);
    if (node) node.premultipliedAlpha = v;
};
