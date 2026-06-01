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
    if (node.nodeType === 'textBox') el.classList.add('text-box-node');
    if (node.nodeType === 'shortText') el.classList.add('short-text-node');
    el.id = 'sn-' + node.id;
    el.style.minWidth = '200px';

    // 动画下拉框选项
    var missingForFile = (SMData._missingStates && node.sourceFile) ? (SMData._missingStates[node.sourceFile] || null) : null;
    var missingSet = missingForFile ? new Set(missingForFile.anims) : new Set();
    var animOptionsHtml = '';
    for (var ai = 0; ai < node.animations.length; ai++) {
        var aa = node.animations[ai];
        var sel = node.currentAnim === aa.name ? ' selected' : '';
        var isMissing = missingSet.has(aa.name);
        animOptionsHtml += '<option value="' + SMTool._esc(aa.name) + '"' + sel +
            (isMissing ? ' class="missing-option"' : '') + '>' +
            SMTool._esc(aa.name) + ' (' + aa.duration.toFixed(2) + 's)</option>';
    }
    if (!animOptionsHtml) animOptionsHtml = '<option value="">-- 无动画 --</option>';

    var curState = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';

    var currentSkin = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
    var skinsHtml = '';
    for (var si = 0; si < node.skins.length; si++) {
        var skinName = node.skins[si];
        var isActive = skinName === currentSkin ? ' active' : '';
        skinsHtml += '<span class="badge skin-badge' + isActive + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._esc(skinName) + '\')" title="切换皮肤: ' + SMTool._esc(skinName) + '">' + SMTool._esc(skinName) + '</span>';
    }
    if (!skinsHtml) skinsHtml = '<span class="badge">无皮肤</span>';

    if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
        var textContent = SMTool._esc(node._textContent || '');
        if (node.nodeType === 'shortText') {
            el.innerHTML =
                '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                    '<span class="name" style="font-size:39px">' + SMTool._esc(node.name) + '</span>' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px">✕</button>' +
                '</div>' +
                '<textarea class="text-node-input" oninput="SMTool._updateTextNode(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入条件...">' + textContent + '</textarea>' +
                '<div class="anim-bar" style="margin-top:4px">' +
                    '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'input\')" title="连线输入"></div>' +
                    '<span style="flex:1"></span>' +
                    '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'output\')" title="连线输出"></div>' +
                '</div>';
        } else {
            // textBox
            el.innerHTML =
                '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                    '<input class="text-box-title" value="' + SMTool._esc(node.name) + '" oninput="SMTool._updateTextNodeName(' + node.id + ',this.value)" onclick="event.stopPropagation()" style="width:0;flex:1;min-width:0;background:transparent;border:none;color:var(--text);font-size:39px;font-weight:600;outline:none">' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px">✕</button>' +
                '</div>' +
                '<div class="text-box-area" contenteditable="true" oninput="SMTool._updateTextNode(' + node.id + ',this.innerText)" onclick="event.stopPropagation()">' + textContent + '</div>' +
                '<div class="anim-bar" style="margin-top:4px">' +
                    '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'input\')" title="连线输入"></div>' +
                    '<span style="flex:1"></span>' +
                    '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'output\')" title="连线输出"></div>' +
                '</div>';
        }
    } else {
    el.innerHTML =
        '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
            '<div class="header-titles">' +
                (node.sourceFile ? '<span class="source-file">' + SMTool._esc(node.sourceFile) + '</span>' : '') +
                '<span class="name">' + SMTool._esc(node.name) + '</span>' +
            '</div>' +
            '<div class="btns">' +
                '<button onclick="event.stopPropagation();SMTool.copyNode(' + node.id + ',50,50);" title="复制节点">📋</button>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="spine-canvas-wrap" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._onND(event,' + node.id + ')">' +
            '<div style="color:var(--text2);padding:40px">拖入 Spine 文件</div>' +
        '</div>' +
        '<div class="anim-bar">' +
            '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._esc(curState) + '\',\'input\')" title="连线输入"></div>' +
            '<select class="anim-select" onchange="SMTool._onAnimChange(' + node.id + ', this.value)">' + animOptionsHtml + '</select>' +
            '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._esc(curState) + '\',\'output\')" title="连线输出"></div>' +
        '</div>' +
        '<div class="footer">' +
            '<div class="footer-skins"><span class="skin-label">皮肤</span>' + skinsHtml + '</div>' +
            '<div class="footer-controls">' +
                '<button class="loop-toggle' + (node.loop !== false ? ' active' : '') + '" onclick="event.stopPropagation();SMTool._toggleLoop(' + node.id + ')">' + (node.loop !== false ? '🔄 循环播放' : '▶ 单次播放') + '</button>' +
                '<label class="pma-toggle" title="预乘 Alpha"><input type="checkbox" onchange="SMTool._togglePMA(' + node.id + ',this.checked)"' + (node.premultipliedAlpha ? ' checked' : '') + '>预乘Alpha</label>' +
            '</div>' +
        '</div>' +
        '<div class="node-extras">' +
            '<div class="bone-tags" id="boneTags-' + node.id + '"></div>' +
            '<textarea class="state-desc" placeholder="点击输入此状态的描述" oninput="SMTool._updateStateDesc(' + node.id + ',this.value)" onclick="event.stopPropagation()">' + SMTool._esc(node._stateDesc || '') + '</textarea>' +
            '<span class="version-badge">v' + SMTool._esc(node.version || '?') + '</span>' +
        '</div>';
    }

    SMTool.nodesLayer.appendChild(el);
};

// ---- 文本节点内容更新 ----
SMTool._updateTextNode = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._textContent = value;
};
SMTool._updateTextNodeName = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node.name = value;
};

// ---- 循环/单次切换 ----
SMTool._toggleLoop = function (nid) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    node.loop = !node.loop;
    if (node.state) {
        // 更新当前动画的循环模式
        var track = node.state.getCurrent(0);
        if (track && track.animation) {
            node.state.setAnimation(0, track.animation.name, node.loop);
        }
    }
    var btn = document.querySelector('#sn-' + nid + ' .loop-toggle');
    if (btn) {
        btn.textContent = node.loop ? '🔄 循环播放' : '▶ 单次播放';
        btn.classList.toggle('active', node.loop);
    }
};

// ---- 状态描述更新 ----
SMTool._updateStateDesc = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._stateDesc = value;
    var ta = document.querySelector('#sn-' + nid + ' .state-desc');
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.max(32, ta.scrollHeight) + 'px'; }
};

// ---- 骨骼标记 ----
SMTool._toggleBoneTag = function (boneName) {
    // 多选时应用到所有选中节点
    if (SMData.selectedNodes.size > 1) {
        SMData.selectedNodes.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (!n || n.nodeType !== 'spine') return;
            if (!n._boneTags) n._boneTags = {};
            if (n._boneTags[boneName]) {
                delete n._boneTags[boneName];
            } else {
                n._boneTags[boneName] = [];
            }
            SMTool._refreshBoneTagsUI(n);
        });
    } else {
        var node = SMData.nodes.get(SMData.selectedNode);
        if (!node || node.nodeType !== 'spine') return;
        if (!node._boneTags) node._boneTags = {};
        if (node._boneTags[boneName]) {
            delete node._boneTags[boneName];
        } else {
            node._boneTags[boneName] = [];
        }
        SMTool._refreshBoneTagsUI(node);
    }
    SMTool._updateFloatPanel();
};

SMTool._addBoneTagState = function (nid, boneName, stateName) {
    var node = SMData.nodes.get(nid);
    if (!node || !node._boneTags || !node._boneTags[boneName]) return;
    if (node._boneTags[boneName].indexOf(stateName) < 0) {
        node._boneTags[boneName].push(stateName);
        SMTool._refreshBoneTagsUI(node);
        SMTool._updateFloatPanel();
    }
};

SMTool._refreshBoneTagsUI = function (node) {
    var el = document.getElementById('boneTags-' + node.id);
    if (!el) return;
    if (!node._boneTags || Object.keys(node._boneTags).length === 0) {
        el.innerHTML = '';
        return;
    }
    var html = '<span class="bone-tag-title">挂点</span>';
    var bones = Object.keys(node._boneTags);
    for (var b = 0; b < bones.length; b++) {
        var bn = bones[b];
        var states = node._boneTags[bn] || [];
        html += '<div class="bone-tag-capsule" onclick="event.stopPropagation();SMTool._showBoneStateMenu(event,' + node.id + ',\'' + SMTool._esc(bn) + '\')">' +
            '<span class="bone-tag-name">' + SMTool._esc(bn) + '</span>';
        for (var s = 0; s < states.length; s++) {
            html += '<div class="bone-tag-state-capsule">' + SMTool._esc(states[s]) + '</div>';
        }
        html += '</div>';
    }
    html += '<button class="bone-tag-add-btn" onclick="event.stopPropagation();SMTool._showBoneAddMenu(event,' + node.id + ')" title="添加挂点">+</button>';
    el.innerHTML = html;
};

// ---- 挂点添加按钮：弹出骨骼选择菜单 ----
SMTool._showBoneAddMenu = function (e, nid) {
    e.stopPropagation();
    var node = SMData.nodes.get(nid);
    if (!node || node.bones.length === 0) return;
    var menu = document.createElement('div');
    menu.className = 'bone-state-menu';
    menu.style.cssText = 'position:fixed;z-index:200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;padding:4px;max-height:200px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    for (var i = 0; i < node.bones.length; i++) {
        var bn = node.bones[i];
        var item = document.createElement('div');
        item.className = 'bone-state-item';
        item.textContent = bn;
        item.onclick = (function (bn2) {
            return function () {
                if (menu.parentNode) document.body.removeChild(menu);
                SMTool._toggleBoneTag(bn2);
            };
        })(bn);
        menu.appendChild(item);
    }
    document.body.appendChild(menu);
    setTimeout(function () {
        var closeMenu = function (ev) {
            if (!menu.parentNode) { document.removeEventListener('click', closeMenu); return; }
            if (!menu.contains(ev.target)) { document.body.removeChild(menu); document.removeEventListener('click', closeMenu); }
        };
        document.addEventListener('click', closeMenu);
    }, 0);
};

SMTool._showBoneStateMenu = function (e, nid, boneName) {
    e.stopPropagation();
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var menu = document.createElement('div');
    menu.className = 'bone-state-menu';
    menu.style.cssText = 'position:fixed;z-index:200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;padding:4px;max-height:200px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    for (var i = 0; i < node.animations.length; i++) {
        var an = node.animations[i].name;
        var item = document.createElement('div');
        item.className = 'bone-state-item';
        item.textContent = an;
        item.style.cssText = 'padding:4px 10px;cursor:pointer;font-size:13px;color:var(--text);border-radius:4px';
        item.onmouseover = function () { this.style.background = 'var(--node-bg)'; };
        item.onmouseout = function () { this.style.background = 'transparent'; };
        (function (an2) {
            item.onclick = function () {
                SMTool._addBoneTagState(nid, boneName, an2);
                menu.remove();
            };
        })(an);
        menu.appendChild(item);
    }
    document.body.appendChild(menu);
    var close = function (ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
    };
    setTimeout(function () { document.addEventListener('click', close); }, 0);
};

// ---- 更新节点 DOM ----
SMTool._updateEl = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    if (node.nodeType !== 'spine') return;  // 文本节点无需刷新

    // 动画下拉框
    var sel = el.querySelector('.anim-select');
    if (sel) {
        var curVal = sel.value;
        var missingForFile2 = (SMData._missingStates && node.sourceFile) ? (SMData._missingStates[node.sourceFile] || null) : null;
        var missingSet2 = missingForFile2 ? new Set(missingForFile2.anims) : new Set();
        var optionsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var a = node.animations[ai];
            var selected = node.currentAnim === a.name ? ' selected' : '';
            var isMissing2 = missingSet2.has(a.name);
            optionsHtml += '<option value="' + SMTool._esc(a.name) + '"' + selected +
                (isMissing2 ? ' class="missing-option"' : '') + '>' +
                SMTool._esc(a.name) + ' (' + a.duration.toFixed(2) + 's)</option>';
        }
        if (!optionsHtml) optionsHtml = '<option value="">-- 无动画 --</option>';
        sel.innerHTML = optionsHtml;
        // 确保选中当前动画
        if (node.currentAnim && sel.value !== node.currentAnim) {
            sel.value = node.currentAnim;
        }
    }

    // 更新连线圆点的 onclick 属性（指向当前状态）
    var curState = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';
    var curStateEsc = SMTool._esc(curState);
    var inputDot = el.querySelector('.anim-bar .conn-dot.input');
    var outputDot = el.querySelector('.anim-bar .conn-dot.output');
    if (inputDot) inputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','input')");
    if (outputDot) outputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','output')");

    // 底部信息
    var ft = el.querySelector('.footer');
    if (ft) {
        var currentSkin2 = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
        var skinsHtml = '';
        for (var si = 0; si < node.skins.length; si++) {
            var skinName = node.skins[si];
            var isActive = skinName === currentSkin2 ? ' active' : '';
            skinsHtml += '<span class="badge skin-badge' + isActive + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._esc(skinName) + '\')" title="切换皮肤: ' + SMTool._esc(skinName) + '">' + SMTool._esc(skinName) + '</span>';
        }
        ft.innerHTML =
            '<div class="footer-skins"><span class="skin-label">皮肤</span>' + (skinsHtml || '<span class="badge">无皮肤</span>') + '</div>' +
            '<div class="footer-controls">' +
                '<button class="loop-toggle' + (node.loop !== false ? ' active' : '') + '" onclick="event.stopPropagation();SMTool._toggleLoop(' + node.id + ')">' + (node.loop !== false ? '🔄 循环播放' : '▶ 单次播放') + '</button>' +
                '<label class="pma-toggle" title="预乘 Alpha"><input type="checkbox" onchange="SMTool._togglePMA(' + node.id + ',this.checked)"' + (node.premultipliedAlpha ? ' checked' : '') + '>预乘Alpha</label>' +
            '</div>';
        // 版本号
        var vb = el.querySelector('.version-badge');
        if (vb) vb.textContent = 'v' + (node.version || '?');
    }
    // 刷新骨骼标记和循环按钮
    SMTool._refreshBoneTagsUI(node);
    var loopBtn = el.querySelector('.loop-toggle');
    if (loopBtn) {
        loopBtn.textContent = node.loop !== false ? '🔄 循环播放' : '▶ 单次播放';
        loopBtn.classList.toggle('active', node.loop !== false);
    }

    // 标题
    var hn = el.querySelector('.header .name');
    if (hn) { hn.textContent = node.name; hn.title = node.name; }
    var sf = el.querySelector('.header .source-file');
    if (node.sourceFile) {
        if (sf) { sf.textContent = node.sourceFile; }
        else {
            // 动态插入 source-file
            var titles = el.querySelector('.header-titles');
            if (titles) {
                var newSf = document.createElement('span');
                newSf.className = 'source-file';
                newSf.textContent = node.sourceFile;
                titles.insertBefore(newSf, titles.firstChild);
            }
        }
    }

    // PMA - handled via floating panel
};

// ---- 获取节点 DOM 元素 ----
SMTool._getEl = function (id) {
    return document.getElementById('sn-' + id);
};

// ---- 更新节点位置 ----
SMTool._updatePos = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    var z = SMData.view.zoom;
    var s = SMTool.worldToDOM(node.x, node.y);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.transform = 'scale(' + z + ')';
    el.style.transformOrigin = 'top left';

    SMTool._updateFloatLabels();
};

SMTool._updateAllPos = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        SMTool._updatePos(result.value);
        result = nodesIter.next();
    }

    // 连线端口：画布缩小时放大，最大2倍
    var z = SMData.view.zoom;
    var dotScale = Math.min(2, 2 - z);
    var dots = document.querySelectorAll('.spine-node .conn-dot');
    for (var i = 0; i < dots.length; i++) {
        dots[i].style.transform = 'scale(' + dotScale + ')';
    }

    SMTool._updateFloatLabels();
};

// ---- 浮动大字标签（缩放 < 40% 时显示，固定字号不随缩放放大）----
SMTool._floatLabels = {};

SMTool._updateFloatLabels = function () {
    var container = document.getElementById('floatLabels');
    if (!container) return;
    var z = SMData.view.zoom;
    var show = z < 0.40;
    var seen = {};

    if (show) {
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        while (!result.done) {
            var node = result.value;
            if (!node.skeleton) { result = nodesIter.next(); continue; }
            seen[node.id] = true;

            var label = SMTool._floatLabels[node.id];
            if (!label) {
                label = document.createElement('div');
                label.className = 'float-label';
                container.appendChild(label);
                SMTool._floatLabels[node.id] = label;
            }
            label.style.display = '';

            var sp = SMTool.worldToCanvas(node.x, node.y);
            var fontSize = 22;
            label.style.left = sp.x + 'px';
            label.style.top = (sp.y - fontSize * 2) + 'px';
            label.style.fontSize = fontSize + 'px';

            var name = node.name || '';
            var state = node.currentAnim || '';
            label.innerHTML = '<span class="fl-name">' + SMTool._esc(name) + '</span>' +
                (state ? '<span class="fl-state">' + SMTool._esc(state) + '</span>' : '');
            result = nodesIter.next();
        }
    }

    var keys = Object.keys(SMTool._floatLabels);
    for (var i = 0; i < keys.length; i++) {
        var id = keys[i];
        if (!show || !seen[id]) {
            var old = SMTool._floatLabels[id];
            if (old) {
                if (!SMData.nodes.has(parseInt(id))) {
                    if (old.parentNode) old.remove();
                    delete SMTool._floatLabels[id];
                } else {
                    old.style.display = 'none';
                }
            }
        }
    }
};

// ---- 更新选中状态 ----
SMTool._updateSel = function () {
    // 计算焦点集合：选中节点 + 直接连线节点
    var focusSet = new Set();
    if (SMData.selectedNodes.size >= 1) {
        var selIter = SMData.selectedNodes.values();
        var sr = selIter.next();
        while (!sr.done) {
            var selId = sr.value;
            focusSet.add(selId);
            for (var ci = 0; ci < SMData.connections.length; ci++) {
                var c = SMData.connections[ci];
                if (c.fromNode === selId) focusSet.add(c.toNode);
                if (c.toNode === selId) focusSet.add(c.fromNode);
            }
            sr = selIter.next();
        }
    }
    SMData._focusNodes = focusSet;

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            el.classList.toggle('selected', SMData.selectedNodes.has(n.id));
            var isDimmed = focusSet.size > 0 && !focusSet.has(n.id);
            var overlay = el.querySelector('.dim-overlay');
            if (isDimmed && !overlay) {
                overlay = document.createElement('div');
                overlay.className = 'dim-overlay';
                el.appendChild(overlay);
            } else if (!isDimmed && overlay) {
                overlay.remove();
            }
            if (SMData.connecting && SMData.connecting.nodeId === n.id) {
                el.classList.add('connecting');
            } else {
                el.classList.remove('connecting');
            }
        }
        result = nodesIter.next();
    }
    SMTool._updateFloatPanel();
};

// ---- 更新左侧浮窗面板数据 ----
SMTool._updateFloatPanel = function () {
    var content = document.getElementById('dfpContent');
    var panel = document.getElementById('dataFloatPanel');
    if (!content || !panel) return;

    // 仅当单选一个节点时显示数据
    if (SMData.selectedNodes.size === 1 && SMData.selectedNode) {
        panel.classList.remove('inactive');
        var node = SMData.nodes.get(SMData.selectedNode);
        if (!node) { content.innerHTML = '<div class="dfp-hint">未找到节点数据</div>'; return; }

        var animsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var a = node.animations[ai];
            var isActive = node.currentAnim === a.name;
            animsHtml += '<div class="dfp-row' + (isActive ? ' active' : '') + '"><span>' + SMTool._esc(a.name) + '</span><span>' + a.duration.toFixed(2) + 's</span></div>';
        }
        if (!animsHtml) animsHtml = '<div class="dfp-row">无</div>';

        var currentSkin = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
        var skinRows = '';
        for (var si = 0; si < node.skins.length; si++) {
            var skName = node.skins[si];
            var isActiveSkin = skName === currentSkin ? ' active' : '';
            skinRows += '<span class="dfp-skin-badge' + isActiveSkin + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._esc(skName) + '\')" title="切换皮肤: ' + SMTool._esc(skName) + '">' + SMTool._esc(skName) + '</span>';
        }
        if (!skinRows) skinRows = '<span class="dfp-skin-badge">default</span>';

        var boneRows = '';
        var curAnim = node.currentAnim || '';
        var storeKey = (node.sourceFile || node.name) + '||' + curAnim;
        var boneLabels = SMData._boneLabelStore[storeKey] || {};
        for (var bi = 0; bi < node.bones.length; bi++) {
            var boneName = node.bones[bi];
            var label = boneLabels[boneName] || '';
            var labelHtml = '';
            if (label) {
                labelHtml = '<span class="dfp-bone-label" data-bone="' + SMTool._esc(boneName) + '" title="点击编辑标签">' +
                    SMTool._esc(label) +
                    '<span class="dfp-bone-label-del" data-bone="' + SMTool._esc(boneName) + '" title="删除标签">&times;</span>' +
                '</span>';
            }
            // 获取该骨骼被标记的状态
            var taggedStates = (node._boneTags && node._boneTags[boneName]) ? node._boneTags[boneName].join(', ') : '';
            var taggedHtml = taggedStates ? '<span class="dfp-bone-tagged">' + SMTool._esc(taggedStates) + '</span>' : '';
            boneRows += '<div class="dfp-row dfp-bone-row" data-bone="' + SMTool._esc(boneName) + '">' +
                '<span>' + SMTool._esc(boneName) + '</span>' +
                    '<button class="dfp-bone-tag-btn" data-bone="' + SMTool._esc(boneName) + '" style="font-size:14px;cursor:pointer;background:none;border:1px solid #50c878;color:#50c878;border-radius:4px;padding:0 6px;margin-left:8px">标记</button>' +
                    '<span class="dfp-bone-right" style="margin-left:auto;display:flex;align-items:center;gap:6px">' + taggedHtml + labelHtml + '</span></div>';
        }
        if (!boneRows) boneRows = '<div class="dfp-row">无</div>';

        var slotRows = '';
        for (var sli = 0; sli < node.slots.length; sli++) {
            slotRows += '<div class="dfp-row">' + SMTool._esc(node.slots[sli]) + '</div>';
        }
        if (!slotRows) slotRows = '<div class="dfp-row">无</div>';

        var sourceInfo = '';
        if (node._srcFileNames && node._srcFileNames.length > 0) {
            var sfRows = '';
            for (var sfi = 0; sfi < node._srcFileNames.length; sfi++) {
                sfRows += '<div class="dfp-row" style="word-break:break-all;font-size:11px">' + SMTool._esc(node._srcFileNames[sfi]) + '</div>';
            }
            sourceInfo = '<div class="dfp-section"><div class="dfp-section-title">📁 源文件 (' + node._srcFileNames.length + ')</div>' + sfRows + '</div>';
        } else if (node.sourceFile) {
            sourceInfo = '<div class="dfp-section"><div class="dfp-section-title">📁 源文件</div><div class="dfp-row" style="word-break:break-all">' + SMTool._esc(node.sourceFile) + '</div></div>';
        }

        content.innerHTML =
            '<div class="dfp-section"><div class="dfp-section-title">🏷️ 节点名称</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
            sourceInfo +
            '<div class="dfp-section"><div class="dfp-section-title">📦 Spine 版本</div><div class="dfp-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🎬 动画 (' + node.animations.length + ')</div>' + animsHtml + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🎨 皮肤 (' + node.skins.length + ')</div>' + skinRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🦴 骨骼 (' + node.bones.length + ')</div>' + boneRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🔧 插槽 (' + node.slots.length + ')</div>' + slotRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-check-row"><input type="checkbox" id="dfpPma" ' + (node.premultipliedAlpha ? 'checked' : '') + ' onchange="SMTool._togglePMA(' + node.id + ',this.checked)"><label for="dfpPma">预乘 Alpha 通道</label></div></div>';
    } else if (SMData.selectedNodes.size > 1) {
        // 多选时，检查是否同一源文件
        var sampleNode = null;
        var sameFile = true;
        var firstFile = null;
        var activeAnims = {};  // { animName: true }
        var allPma = null;
        SMData.selectedNodes.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (!n) return;
            if (!sampleNode) { sampleNode = n; firstFile = n.sourceFile; }
            if (n.sourceFile !== firstFile) sameFile = false;
            if (n.currentAnim) activeAnims[n.currentAnim] = true;
            if (allPma === null) allPma = n.premultipliedAlpha;
            else if (allPma !== n.premultipliedAlpha) allPma = 'mixed';
        });

        if (sameFile && sampleNode && sampleNode.sourceFile) {
            panel.classList.remove('inactive');
            var node = sampleNode;

            var animsHtml2 = '';
            for (var ai2 = 0; ai2 < node.animations.length; ai2++) {
                var a2 = node.animations[ai2];
                var isActive2 = !!activeAnims[a2.name];
                animsHtml2 += '<div class="dfp-row' + (isActive2 ? ' active' : '') + '"><span>' + SMTool._esc(a2.name) + '</span><span>' + a2.duration.toFixed(2) + 's</span></div>';
            }
            if (!animsHtml2) animsHtml2 = '<div class="dfp-row">无</div>';

            var currentSkin2 = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
            var skinRows2 = '';
            for (var si2 = 0; si2 < node.skins.length; si2++) {
                var skName2 = node.skins[si2];
                var isActiveSkin2 = skName2 === currentSkin2 ? ' active' : '';
                skinRows2 += '<span class="dfp-skin-badge' + isActiveSkin2 + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._esc(skName2) + '\')" title="切换皮肤: ' + SMTool._esc(skName2) + '">' + SMTool._esc(skName2) + '</span>';
            }
            if (!skinRows2) skinRows2 = '<span class="dfp-skin-badge">default</span>';

            var boneRows2 = '';
            var curAnim2 = node.currentAnim || '';
            var storeKey2 = (node.sourceFile || node.name) + '||' + curAnim2;
            var boneLabels2 = SMData._boneLabelStore[storeKey2] || {};
            for (var bi2 = 0; bi2 < node.bones.length; bi2++) {
                var boneName2 = node.bones[bi2];
                var label2 = boneLabels2[boneName2] || '';
                var labelHtml2 = label2 ? '<span class="dfp-bone-label" data-bone="' + SMTool._esc(boneName2) + '">' + SMTool._esc(label2) + '<span class="dfp-bone-label-del" data-bone="' + SMTool._esc(boneName2) + '">&times;</span></span>' : '';
                var taggedStates2 = (node._boneTags && node._boneTags[boneName2]) ? node._boneTags[boneName2].join(', ') : '';
                var taggedHtml2 = taggedStates2 ? '<span class="dfp-bone-tagged">' + SMTool._esc(taggedStates2) + '</span>' : '';
                boneRows2 += '<div class="dfp-row dfp-bone-row" data-bone="' + SMTool._esc(boneName2) + '"><span>' + SMTool._esc(boneName2) + '</span><button class="dfp-bone-tag-btn" data-bone="' + SMTool._esc(boneName2) + '" style="font-size:14px;cursor:pointer;background:none;border:1px solid #50c878;color:#50c878;border-radius:4px;padding:0 6px;margin-left:8px">标记</button><span class="dfp-bone-right" style="margin-left:auto;display:flex;align-items:center;gap:6px">' + taggedHtml2 + labelHtml2 + '</span></div>';
            }
            if (!boneRows2) boneRows2 = '<div class="dfp-row">无</div>';

            var slotRows2 = '';
            for (var sli2 = 0; sli2 < node.slots.length; sli2++) {
                slotRows2 += '<div class="dfp-row">' + SMTool._esc(node.slots[sli2]) + '</div>';
            }
            if (!slotRows2) slotRows2 = '<div class="dfp-row">无</div>';

            var checkedStr = (allPma === true) ? 'checked' : '';
            content.innerHTML =
                '<div class="dfp-section"><div class="dfp-section-title">🏷️ 已选 ' + SMData.selectedNodes.size + ' 个节点（同源）</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📦 Spine 版本</div><div class="dfp-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">🎬 动画 (' + node.animations.length + ')</div>' + animsHtml2 + '</div>' +
                '<div class="dfp-section"><div class="dfp-section-title">🎨 皮肤 (' + node.skins.length + ')</div>' + skinRows2 + '</div>' +
                '<div class="dfp-section"><div class="dfp-section-title">🦴 骨骼 (' + node.bones.length + ')</div>' + boneRows2 + '</div>' +
                '<div class="dfp-section"><div class="dfp-section-title">🔧 插槽 (' + node.slots.length + ')</div>' + slotRows2 + '</div>' +
                '<div class="dfp-section"><div class="dfp-check-row"><input type="checkbox" id="dfpPma" ' + checkedStr + ' onchange="SMTool._toggleMultiPMA(this.checked)"><label for="dfpPma">预乘 Alpha 通道</label></div></div>';
        } else {
            panel.classList.add('inactive');
            content.innerHTML = '<div class="dfp-hint">已多选 ' + SMData.selectedNodes.size + ' 个节点</div>';
        }
    } else {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="dfp-hint">点击一个 Spine 节点以查看其动画数据</div>';
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

        // 来源节点
        if (!stateColors.has(c.fromNode)) stateColors.set(c.fromNode, new Map());
        var fromMap = stateColors.get(c.fromNode);
        if (!fromMap.has(c.fromState)) fromMap.set(c.fromState, []);
        fromMap.get(c.fromState).push({ color: color, alpha: alpha, isSel: isSel });

        // 目标节点
        if (!stateColors.has(c.toNode)) stateColors.set(c.toNode, new Map());
        var toMap = stateColors.get(c.toNode);
        if (!toMap.has(c.toState)) toMap.set(c.toState, []);
        toMap.get(c.toState).push({ color: color, alpha: alpha, isSel: isSel });
    }

    // 应用到 DOM — 为 anim-bar 着色
    var stateEntriesIter = stateColors.entries();
    var seResult = stateEntriesIter.next();
    while (!seResult.done) {
        var nid = seResult.value[0];
        var stateMap = seResult.value[1];
        var el = SMTool._getEl(nid);
        if (el) {
            var bar = el.querySelector('.anim-bar');
            if (bar) {
                // 获取当前动画名来匹配连接
                var node = SMData.nodes.get(nid);
                var curState = node ? node.currentAnim : '';
                var infos = stateMap.get(curState);
                if (infos && infos.length > 0) {
                    var info = infos[0];
                    bar.style.backgroundColor = info.color + info.alpha;
                    bar.style.borderLeft = '3px solid ' + info.color;
                } else {
                    bar.style.backgroundColor = '';
                    bar.style.borderLeft = '';
                }
            }
        }
        seResult = stateEntriesIter.next();
    }
};

// ---- PMA 切换 ----
SMTool._togglePMA = function (nid, v) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    node.premultipliedAlpha = v;
    SMTool._updateEl(node);
    SMTool._updateFloatPanel();
};

// 多选时批量切换 PMA
SMTool._toggleMultiPMA = function (v) {
    SMData.selectedNodes.forEach(function (nid) {
        var n = SMData.nodes.get(nid);
        if (n) { n.premultipliedAlpha = v; SMTool._updateEl(n); }
    });
    SMTool._updateFloatPanel();
};

// ---- 重复节点红色高亮检测 ----
SMTool._updateDuplicateHighlights = function () {
    // 按 sourceFile + currentAnim 分组
    var groups = new Map();
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n.sourceFile && n.currentAnim) {
            var key = n.sourceFile + '|' + n.currentAnim;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n.id);
        }
        result = nodesIter.next();
    }

    // 为每个重复组分配不同颜色
    var dupColors = [
        '#ff4444', '#ff8c00', '#ffd700', '#44bb44', '#44aaff',
        '#8844ff', '#ff44aa', '#44dddd', '#ff8844', '#88ff44',
        '#ee3333', '#cc6600', '#eebb00', '#228833', '#3377cc',
        '#6633cc', '#cc2277', '#229999', '#dd5522', '#55aa22'
    ];
    var groupColorMap = {};  // "sourceFile|anim" → color
    var nextColor = 0;

    var groupEntriesIter = groups.entries();
    var gResult = groupEntriesIter.next();
    while (!gResult.done) {
        var key = gResult.value[0];
        var ids = gResult.value[1];
        if (ids.length > 1) {
            groupColorMap[key] = dupColors[nextColor % dupColors.length];
            nextColor++;
        }
        gResult = groupEntriesIter.next();
    }

    // 应用高亮颜色
    var nodesIter2 = SMData.nodes.values();
    var result2 = nodesIter2.next();
    while (!result2.done) {
        var el2 = SMTool._getEl(result2.value.id);
        if (el2) {
            var n2 = result2.value;
            var key2 = n2.sourceFile + '|' + n2.currentAnim;
            var dupList = groups.get(key2);
            var isDup = dupList && dupList.length > 1;
            el2.classList.toggle('duplicate-highlight', isDup);
            if (isDup && groupColorMap[key2]) {
                el2.style.setProperty('--dup-color', groupColorMap[key2]);
                el2.style.setProperty('--dup-glow', groupColorMap[key2] + '80');
            } else {
                el2.style.removeProperty('--dup-color');
                el2.style.removeProperty('--dup-glow');
            }
        }
        result2 = nodesIter2.next();
    }
};

// ---- 缺失状态检测 + 通知面板 ----
SMTool._checkMissingStates = function () {
    // 按 sourceFile 分组，收集每个文件的全部动画列表和已有 currentAnim
    var fileGroups = new Map(); // sourceFile → { allAnims: Set, existingAnims: Set, sampleNode: node }
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n.sourceFile && n.animations.length > 0) {
            if (!fileGroups.has(n.sourceFile)) {
                fileGroups.set(n.sourceFile, { allAnims: new Set(), existingAnims: new Set(), sampleNode: n });
            }
            var g = fileGroups.get(n.sourceFile);
            for (var i = 0; i < n.animations.length; i++) {
                g.allAnims.add(n.animations[i].name);
            }
            if (n.currentAnim) g.existingAnims.add(n.currentAnim);
        }
        result = nodesIter.next();
    }

    // 计算每个文件缺失的状态
    SMData._missingStates = {}; // { sourceFile: [animName, ...] }
    var totalMissing = 0;
    var fileEntriesIter = fileGroups.entries();
    var feResult = fileEntriesIter.next();
    while (!feResult.done) {
        var sf = feResult.value[0];
        var g2 = feResult.value[1];
        var missing = [];
        var allIter = g2.allAnims.values();
        var aiResult = allIter.next();
        while (!aiResult.done) {
            if (!g2.existingAnims.has(aiResult.value)) {
                missing.push(aiResult.value);
            }
            aiResult = allIter.next();
        }
        if (missing.length > 0) {
            SMData._missingStates[sf] = { anims: missing, sampleNode: g2.sampleNode };
            totalMissing += missing.length;
        }
        feResult = fileEntriesIter.next();
    }

    // 更新通知面板
    var panel = document.getElementById('missingPanel');
    var list = document.getElementById('missingList');
    if (totalMissing > 0) {
        panel.classList.add('show');
        var html = '';
        var keys = Object.keys(SMData._missingStates);
        for (var k = 0; k < keys.length; k++) {
            var sf2 = keys[k];
            var info = SMData._missingStates[sf2];
            for (var a = 0; a < info.anims.length; a++) {
                var an = info.anims[a];
                html += '<div class="mp-item">' +
                    '<div class="mp-info">' +
                        '<div class="mp-file">' + SMTool._esc(sf2) + '</div>' +
                        '<div class="mp-state">⚠ ' + SMTool._esc(an) + ' 未被创建</div>' +
                    '</div>' +
                    '<button class="mp-btn" onclick="SMTool._createMissingNode(\'' + SMTool._esc(sf2) + '\',\'' + SMTool._esc(an) + '\')">创建</button>' +
                '</div>';
            }
        }
        list.innerHTML = html;
    } else {
        panel.classList.remove('show');
        list.innerHTML = '';
    }

    console.log('[MissingCheck] ' + SMData.nodes.size + ' 个节点，缺失 ' + totalMissing + ' 个状态');
};

// ---- 创建缺失的动画节点 ----
SMTool._createMissingNode = function (sourceFile, animName) {
    // 找到同文件的一个已有节点作为数据源
    var sourceNode = null;
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        if (r2.value.sourceFile === sourceFile && r2.value._srcAtlasText) {
            sourceNode = r2.value;
            break;
        }
        r2 = nodesIter2.next();
    }
    if (!sourceNode) return;

    // 在视窗中心创建
    var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.name = SMTool._translateName(animName);
    node.sourceFile = sourceFile;
    node.x = wp.x;
    node.y = wp.y;
    node._srcSkelJson = sourceNode._srcSkelJson;
    node._srcSkelBinBase64 = sourceNode._srcSkelBinBase64;
    node._srcAtlasText = sourceNode._srcAtlasText;
    node._srcTexDataUrl = sourceNode._srcTexDataUrl;
    node._srcType = sourceNode._srcType;
    node.currentAnim = animName;
    node.animations = sourceNode.animations.slice();
    node.skins = sourceNode.skins.slice();
    node.slots = sourceNode.slots.slice();
    node.bones = sourceNode.bones.slice();
    node.version = sourceNode.version;

    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);

    SMTool._loadFromSourceData(node).then(function () {
        SMTool._updateEl(node);
        SMTool._updatePos(node);
        // 刷新同文件所有节点的下拉框（缺失标记需更新）
        var nodesIter3 = SMData.nodes.values();
        var r3 = nodesIter3.next();
        while (!r3.done) {
            if (r3.value.sourceFile === sourceFile && r3.value.id !== node.id) {
                SMTool._updateEl(r3.value);
            }
            r3 = nodesIter3.next();
        }
        SMTool._checkMissingStates();
        SMTool._updateDuplicateHighlights();
        SMTool._refreshAllTranslations();
        SMTool._updateSB();
    }).catch(function (err) {
        console.error('[MissingCreate] Failed:', err);
    });

    SMTool._updateSB();
    document.getElementById('sbStatus').textContent = '已创建: ' + animName;
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
};
