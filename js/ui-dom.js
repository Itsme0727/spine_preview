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
    } else if (node.nodeType === 'entry') {
        el.classList.add('entry-node');
        var entryText = SMTool._esc(node._exitText || '');
        el.innerHTML =
            '<div class="header entry-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<span class="entry-title">🚪 入口</span>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;flex-shrink:0">✕</button>' +
            '</div>' +
            '<div class="entry-body">' +
                '<div class="entry-icon">🚪</div>' +
                '<textarea class="entry-text-input" oninput="SMTool._updateExitText(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入入口条件...">' + entryText + '</textarea>' +
            '</div>' +
            '<div class="anim-bar" style="display:flex;justify-content:flex-end">' +
                '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'entry\',\'output\')" title="连线输出"></div>' +
            '</div>';
    } else if (node.nodeType === 'exit') {
        el.classList.add('exit-node');
        var exitText = SMTool._esc(node._exitText || '');
        el.innerHTML =
            '<div class="header exit-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<span class="exit-title">🏁 出口</span>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;flex-shrink:0">✕</button>' +
            '</div>' +
            '<div class="exit-body">' +
                '<div class="exit-icon">🏁</div>' +
                '<textarea class="exit-text-input" oninput="SMTool._updateExitText(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入出口条件...">' + exitText + '</textarea>' +
            '</div>' +
            '<div class="anim-bar" style="display:flex;justify-content:flex-start">' +
                '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'exit\',\'input\')" title="连线输入"></div>' +
            '</div>';
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
SMTool._updateExitText = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._exitText = value;
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
            var fontSize = 15;
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
    // 计算焦点集合
    var focusSet = new Set();
    if (SMData._flowFocus) {
        // 流程面板高亮模式：使用流程焦点节点
        SMData._flowFocus.nodeIds.forEach(function (nid) { focusSet.add(nid); });
    } else if (SMData.flowMode === 'full' && SMData.selectedNode) {
        // 完整动画组模式：自动设置全组件焦点
        SMTool._setFullComponentFocus(SMData.selectedNode);
        if (SMData._flowFocus) {
            SMData._flowFocus.nodeIds.forEach(function (nid) { focusSet.add(nid); });
        }
    } else if (SMData.connecting) {
        // 连线模式：仅高亮源节点
        focusSet.add(SMData.connecting.nodeId);
    } else if (SMData.selectedNodes.size >= 1) {
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

    // 连线时 input 端点变绿放大，output 端点缩小
    var alreadyConnected = new Set();
    if (SMData.connecting) {
        alreadyConnected.add(SMData.connecting.nodeId);
        for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
            var c2 = SMData.connections[ci2];
            if (c2.fromNode === SMData.connecting.nodeId) alreadyConnected.add(c2.toNode);
        }
    }
    var allInputDots = document.querySelectorAll('.spine-node .anim-bar .conn-dot.input');
    for (var di = 0; di < allInputDots.length; di++) {
        var dot = allInputDots[di];
        var nodeEl = dot.closest('.spine-node');
        var nodeId = nodeEl ? parseInt(nodeEl.id.replace('sn-', '')) : 0;
        var shouldHighlight = !!SMData.connecting && !alreadyConnected.has(nodeId);
        dot.classList.toggle('connecting-target', shouldHighlight);
    }
    var allOutputDots = document.querySelectorAll('.spine-node .anim-bar .conn-dot.output');
    for (var do2 = 0; do2 < allOutputDots.length; do2++) {
        allOutputDots[do2].classList.toggle('connecting-shrink', !!SMData.connecting);
    }

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            el.classList.toggle('selected', SMData.selectedNodes.has(n.id));
            var isDimmed = focusSet.size > 0 && !focusSet.has(n.id);
            var isFocused = focusSet.size > 0 && focusSet.has(n.id) && !SMData.selectedNodes.has(n.id);
            el.classList.toggle('focused', isFocused);

            // 完整动画组播放中：当前步骤节点用粉色高亮
            var pb = SMData._fullPlayback;
            var isPlayingCurrent = false;
            if (pb.isPlaying && pb.activePathIdx >= 0) {
                var pp = SMData._fullPaths[pb.activePathIdx];
                if (pp && pb.currentStep < pp.nodes.length && pp.nodes[pb.currentStep].id === n.id) {
                    isPlayingCurrent = true;
                }
            }
            el.classList.toggle('playing-current', isPlayingCurrent);

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
    SMTool._updateFlowPanel();
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

        // 入口/出口节点显示简化面板
        if (node.nodeType === 'entry') {
            content.innerHTML =
                '<div class="dfp-section"><div class="dfp-section-title">🚪 入口节点</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📌 说明</div><div class="dfp-row">状态机的起始入口，从此节点开始连线到其他状态。</div></div>';
            return;
        }
        if (node.nodeType === 'exit') {
            content.innerHTML =
                '<div class="dfp-section"><div class="dfp-section-title">🏁 出口节点</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📝 出口文本</div><div class="dfp-row">' + SMTool._esc(node._exitText || '(空)') + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📌 说明</div><div class="dfp-row">状态机的结束节点，其他状态可连线到此。</div></div>';
            return;
        }

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
                    '<button class="dfp-bone-tag-btn" data-bone="' + SMTool._esc(boneName) + '" style="font-size:14px;cursor:pointer;background:none;border:1px solid #4ec96e;color:#4ec96e;border-radius:4px;padding:0 6px;margin-left:8px">标记</button>' +
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
                boneRows2 += '<div class="dfp-row dfp-bone-row" data-bone="' + SMTool._esc(boneName2) + '"><span>' + SMTool._esc(boneName2) + '</span><button class="dfp-bone-tag-btn" data-bone="' + SMTool._esc(boneName2) + '" style="font-size:14px;cursor:pointer;background:none;border:1px solid #4ec96e;color:#4ec96e;border-radius:4px;padding:0 6px;margin-left:8px">标记</button><span class="dfp-bone-right" style="margin-left:auto;display:flex;align-items:center;gap:6px">' + taggedHtml2 + labelHtml2 + '</span></div>';
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
                var curState = '';
                if (node) {
                    if (node.nodeType === 'entry') curState = 'entry';
                    else if (node.nodeType === 'exit') curState = 'exit';
                    else curState = node.currentAnim || '';
                }
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

// ================================================================
// 更新底部动画组合浮窗面板
// ================================================================
SMTool._updateFlowPanel = function () {
    var content = document.getElementById('flpContent');
    var panel = document.getElementById('flowPanel');
    if (!content || !panel) return;

    if (SMData.flowMode === 'full') {
        SMTool._updateFullFlowPanel(content, panel);
        return;
    }

    // ---- 三层模式（原有逻辑） ----
    // 仅当单选一个节点且该节点有连接时显示
    if (SMData.selectedNodes.size === 1 && SMData.selectedNode) {
        var selNodeId = SMData.selectedNode;
        var selNode = SMData.nodes.get(selNodeId);
        if (!selNode) {
            panel.classList.add('inactive');
            content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其上下游动画组合</div>';
            return;
        }

        // 收集上游连接（selected node 作为 toNode，即左端点被连入）
        var upstreamConns = [];
        // 收集下游连接（selected node 作为 fromNode，即右端点连出）
        var downstreamConns = [];

        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (c.toNode === selNodeId) {
                upstreamConns.push(c);
            }
            if (c.fromNode === selNodeId) {
                downstreamConns.push(c);
            }
        }

        // 没有任何连接
        if (upstreamConns.length === 0 && downstreamConns.length === 0) {
            panel.classList.remove('inactive');
            content.innerHTML = '<div class="flp-no-chain">🔗 节点 "' + SMTool._esc(selNode.name || '') + '" 暂无上下游连线<br/><span style="font-size:11px;color:var(--text2)">使用连线模式连接动画节点即可生成流程</span></div>';
            return;
        }

        panel.classList.remove('inactive');

        // 辅助：将内部标识转为显示名
        var _disp = function (s) {
            if (s === 'entry') return '入口';
            if (s === 'exit') return '出口';
            return s;
        };

        // 获取节点的动画名（优先使用 currentAnim，否则用第一个动画）
        var selAnim = _disp(selNode.currentAnim) || (selNode.animations.length > 0 ? selNode.animations[0].name : selNode.name);

        // 生成流程链 HTML
        var chainsHtml = '';
        var chainIndex = 1;

        // 情况1：有上游也有下游 → 组合成完整链
        if (upstreamConns.length > 0 && downstreamConns.length > 0) {
            for (var u = 0; u < upstreamConns.length; u++) {
                var uc = upstreamConns[u];
                var upNode = SMData.nodes.get(uc.fromNode);
                if (!upNode) continue;
                var upAnimName = _disp(uc.fromState) || (upNode.currentAnim || (upNode.animations.length > 0 ? upNode.animations[0].name : upNode.name));
                var upCond = uc.condition || '';

                for (var d = 0; d < downstreamConns.length; d++) {
                    var dc = downstreamConns[d];
                    var downNode = SMData.nodes.get(dc.toNode);
                    if (!downNode) continue;
                    var downAnimName = _disp(dc.toState) || (downNode.currentAnim || (downNode.animations.length > 0 ? downNode.animations[0].name : downNode.name));
                    var downCond = dc.condition || '';

                    var nodeIds = [upNode.id, selNodeId, downNode.id].join(',');
                    var connIds = [uc.id, dc.id].join(',');
                    chainsHtml += '<div class="flp-chain-group">';
                    chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds + '" data-flow-conns="' + connIds + '">';

                    // 上游节点（第一级）
                    chainsHtml += '<span class="flp-node-l1" title="' + SMTool._esc(upNode.name) + '">' + SMTool._esc(upAnimName) + '</span>';

                    // 箭头 + 上游条件
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    if (upCond) {
                        chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(upCond) + '">条件：' + SMTool._esc(upCond) + '</span>';
                    } else {
                        chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                    }

                    // 箭头 + 当前选中节点（第二级）
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';

                    // 箭头 + 下游条件
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    if (downCond) {
                        chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(downCond) + '">条件：' + SMTool._esc(downCond) + '</span>';
                    } else {
                        chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                    }

                    // 箭头 + 下游节点（第三级）
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    chainsHtml += '<span class="flp-node-l3" title="' + SMTool._esc(downNode.name) + '">' + SMTool._esc(downAnimName) + '</span>';

                    chainsHtml += '</div></div>';
                    chainIndex++;
                }
            }
        }
        // 情况2：只有上游
        else if (upstreamConns.length > 0) {
            for (var u2 = 0; u2 < upstreamConns.length; u2++) {
                var uc2 = upstreamConns[u2];
                var upNode2 = SMData.nodes.get(uc2.fromNode);
                if (!upNode2) continue;
                var upAnimName2 = _disp(uc2.fromState) || (upNode2.currentAnim || (upNode2.animations.length > 0 ? upNode2.animations[0].name : upNode2.name));
                var upCond2 = uc2.condition || '';

                var nodeIds2 = [upNode2.id, selNodeId].join(',');
                var connIds2 = String(uc2.id);
                chainsHtml += '<div class="flp-chain-group">';
                chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds2 + '" data-flow-conns="' + connIds2 + '">';

                chainsHtml += '<span class="flp-node-l1" title="' + SMTool._esc(upNode2.name) + '">' + SMTool._esc(upAnimName2) + '</span>';
                chainsHtml += '<span class="flp-arrow">→</span>';
                if (upCond2) {
                    chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(upCond2) + '">条件：' + SMTool._esc(upCond2) + '</span>';
                } else {
                    chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                }
                chainsHtml += '<span class="flp-arrow">→</span>';
                chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';

                chainsHtml += '</div></div>';
                chainIndex++;
            }
        }
        // 情况3：只有下游
        else if (downstreamConns.length > 0) {
            for (var d2 = 0; d2 < downstreamConns.length; d2++) {
                var dc2 = downstreamConns[d2];
                var downNode2 = SMData.nodes.get(dc2.toNode);
                if (!downNode2) continue;
                var downAnimName2 = _disp(dc2.toState) || (downNode2.currentAnim || (downNode2.animations.length > 0 ? downNode2.animations[0].name : downNode2.name));
                var downCond2 = dc2.condition || '';

                var nodeIds3 = [selNodeId, downNode2.id].join(',');
                var connIds3 = String(dc2.id);
                chainsHtml += '<div class="flp-chain-group">';
                chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds3 + '" data-flow-conns="' + connIds3 + '">';

                chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';
                chainsHtml += '<span class="flp-arrow">→</span>';
                if (downCond2) {
                    chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(downCond2) + '">条件：' + SMTool._esc(downCond2) + '</span>';
                } else {
                    chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                }
                chainsHtml += '<span class="flp-arrow">→</span>';
                chainsHtml += '<span class="flp-node-l3" title="' + SMTool._esc(downNode2.name) + '">' + SMTool._esc(downAnimName2) + '</span>';

                chainsHtml += '</div></div>';
                chainIndex++;
            }
        }

        content.innerHTML = chainsHtml;

        // 如果之前有高亮的组合链，恢复其激活状态
        if (SMData._flowFocus) {
            var rows = content.querySelectorAll('.flp-chain-row');
            var focusConnIds = SMData._flowFocus.connIds;
            for (var ri = 0; ri < rows.length; ri++) {
                var r = rows[ri];
                var connsStr = r.getAttribute('data-flow-conns');
                if (!connsStr) continue;
                var connIdArr = connsStr.split(',');
                var match = connIdArr.length === focusConnIds.size;
                if (match) {
                    for (var cii = 0; cii < connIdArr.length; cii++) {
                        if (!focusConnIds.has(parseInt(connIdArr[cii]))) { match = false; break; }
                    }
                }
                if (match) {
                    r.classList.add('active');
                }
            }
        }
    } else if (SMData.selectedNodes.size > 1) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">已多选 ' + SMData.selectedNodes.size + ' 个节点<br/><span style="font-size:11px">单选一个节点以查看其动画组合</span></div>';
    } else {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其上下游动画组合</div>';
    }
};

// ================================================================
// 完整动画组模式面板
// ================================================================
SMTool._updateFullFlowPanel = function (content, panel) {
    if (SMData.selectedNodes.size !== 1 || !SMData.selectedNode) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其完整动画组合</div>';
        return;
    }

    var selNodeId = SMData.selectedNode;
    var selNode = SMData.nodes.get(selNodeId);
    if (!selNode) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">节点不存在</div>';
        return;
    }

    // 计算所有完整路径
    var paths = SMTool._findAllFullPaths(selNodeId);
    SMData._fullPaths = paths;

    if (paths.length === 0) {
        panel.classList.remove('inactive');
        content.innerHTML = '<div class="flp-no-chain">🔗 节点 "' + SMTool._esc(selNode.name || '') + '" 暂无完整动画组<br/><span style="font-size:11px;color:var(--text2)">从该节点出发没有下游连线</span></div>';
        return;
    }

    panel.classList.remove('inactive');

    // 辅助显示名
    var _disp = function (s) {
        if (s === 'entry') return '入口';
        if (s === 'exit') return '出口';
        return s;
    };

    // 当前播放状态
    var pb = SMData._fullPlayback;
    var activePathIdx = pb.activePathIdx;

    var html = '<div class="flp-full-layout">';
    // 左侧路径列表
    html += '<div class="flp-full-list">';
    for (var pi = 0; pi < paths.length; pi++) {
        var path = paths[pi];
        var isActivePath = (pi === activePathIdx);
        html += '<div class="flp-full-path' + (isActivePath ? ' active' : '') + '" data-path-idx="' + pi + '">';
        html += '<div class="flp-full-path-label">组 #' + (pi + 1) + '</div>';
        html += '<div class="flp-full-path-row">';
        for (var si = 0; si < path.nodes.length; si++) {
            var sn = path.nodes[si];
            var stateClass = 'flp-full-state';
            if (sn.cycleClose) {
                stateClass += ' cycle-close';
            } else if (isActivePath) {
                if (si < pb.currentStep) stateClass += ' played';
                else if (si === pb.currentStep) stateClass += ' current';
                else stateClass += ' upcoming';
            }
            html += '<span class="' + stateClass + '">' + SMTool._esc(_disp(sn.anim)) + '</span>';
            if (si < path.nodes.length - 1) {
                html += '<span class="flp-full-arrow">→</span>';
            }
        }
        html += '</div></div>';
    }
    html += '</div>';

    // 右侧播放器
    html += '<div class="flp-full-player">';
    html += '<canvas class="flp-full-canvas" id="flpFullCanvas"></canvas>';
    html += '<div class="flp-full-controls">';
    html += '<button class="flp-full-btn play" id="flpFullPlay" title="播放">▶</button>';
    html += '<button class="flp-full-btn pause" id="flpFullPause" title="暂停">⏸</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    content.innerHTML = html;

    // 绑定事件
    var pathRows = content.querySelectorAll('.flp-full-path');
    for (var ri = 0; ri < pathRows.length; ri++) {
        (function (idx) {
            pathRows[ri].addEventListener('click', function (e) {
                e.stopPropagation();
                SMTool._selectFullPath(idx);
            });
        })(ri);
    }

    var playBtn = document.getElementById('flpFullPlay');
    var pauseBtn = document.getElementById('flpFullPause');
    if (playBtn) {
        playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            SMTool._startFullPlayback();
        });
    }
    if (pauseBtn) {
        pauseBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            SMTool._pauseFullPlayback();
        });
    }

    // 初始化右侧 Spine 画布
    SMTool._initFullCanvas();
    SMTool._updateFullCanvasForStep();
};

// 设置焦点高亮
// 播放中：仅当前节点+前后连线
// 已选中路径：仅该路径上的节点+连线
// 未选中路径：BFS全组件
SMTool._setFullComponentFocus = function (sourceId) {
    var pb = SMData._fullPlayback;

    if (pb.isPlaying && pb.activePathIdx >= 0) {
        // 播放中：仅当前节点 + 前后连线
        var path = SMData._fullPaths[pb.activePathIdx];
        if (path && pb.currentStep < path.nodes.length) {
            var curNodeId = path.nodes[pb.currentStep].id;
            var nodeIds = new Set();
            var connIds = new Set();
            nodeIds.add(curNodeId);
            if (pb.currentStep > 0 && pb.currentStep - 1 < path.conns.length) {
                connIds.add(path.conns[pb.currentStep - 1]);
            }
            if (pb.currentStep < path.conns.length) {
                connIds.add(path.conns[pb.currentStep]);
            }
            SMData._flowFocus = { nodeIds: nodeIds, connIds: connIds };
            return;
        }
    }

    if (pb.activePathIdx >= 0) {
        // 已选中某条完整路径：路径上所有节点高亮 + 两端都在路径内的所有连线高亮
        var selPath = SMData._fullPaths[pb.activePathIdx];
        if (selPath) {
            var pNodeIds = new Set();
            var pConnIds = new Set();
            for (var ni = 0; ni < selPath.nodes.length; ni++) {
                pNodeIds.add(selPath.nodes[ni].id);
            }
            // 两端都在路径节点内的连线（直接+间接）全部高亮
            for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
                var cc = SMData.connections[ci2];
                if (pNodeIds.has(cc.fromNode) && pNodeIds.has(cc.toNode)) {
                    pConnIds.add(cc.id);
                }
            }
            SMData._flowFocus = { nodeIds: pNodeIds, connIds: pConnIds };
            return;
        }
    }

    // 无选中路径：BFS 全组件焦点
    var nodeIds = new Set();
    var connIds = new Set();
    var queue = [sourceId];
    nodeIds.add(sourceId);
    while (queue.length > 0) {
        var cur = queue.shift();
        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (c.fromNode === cur && !nodeIds.has(c.toNode)) {
                nodeIds.add(c.toNode);
                connIds.add(c.id);
                queue.push(c.toNode);
            }
            if (c.toNode === cur && !nodeIds.has(c.fromNode)) {
                nodeIds.add(c.fromNode);
                connIds.add(c.id);
                queue.push(c.fromNode);
            }
        }
    }
    // 补上所有两端都在 nodeIds 内的间接连线
    for (var j = 0; j < SMData.connections.length; j++) {
        var cj = SMData.connections[j];
        if (nodeIds.has(cj.fromNode) && nodeIds.has(cj.toNode)) {
            connIds.add(cj.id);
        }
    }
    SMData._flowFocus = { nodeIds: nodeIds, connIds: connIds };
};

// 初始化右侧 Spine 画布 — 完整渲染版
SMTool._initFullCanvas = function () {
    var canvas = document.getElementById('flpFullCanvas');
    if (!canvas) return;
    if (SMData._fullCanvasRenderer) return; // 已初始化

    var selNode = SMData.nodes.get(SMData.selectedNode);
    if (!selNode || !selNode.skeletonData || !selNode.textureImg) return;

    try {
        var gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false })
               || canvas.getContext('webgl', { alpha: false, premultipliedAlpha: false });
        if (!gl) return;

        var SP = spine.webgl || spine;
        var context = new SP.ManagedWebGLRenderingContext(canvas, { alpha: false });
        var renderer = new SP.SceneRenderer(canvas, context, true);

        // 从选中节点获取 img 并创建新纹理
        var img = selNode.textureImg;
        var atlas = selNode.atlasData;
        if (!atlas || !atlas.pages) { try { renderer.dispose(); } catch (e) {} return; }

        for (var pi = 0; pi < atlas.pages.length; pi++) {
            var page = atlas.pages[pi];
            var glTex = new SP.GLTexture(context, img, page.pma || false);
            if (typeof page.setTexture === 'function') {
                page.setTexture(glTex);
            } else {
                page.texture = glTex;
            }
            if (!SMData._fullCanvasTextures) SMData._fullCanvasTextures = [];
            SMData._fullCanvasTextures.push(glTex);
        }
        // 更新 region 引用
        try {
            for (var ri2 = 0; ri2 < atlas.regions.length; ri2++) {
                var region = atlas.regions[ri2];
                if (region.page && region.page.texture) {
                    region.texture = region.page.texture;
                }
            }
        } catch (e) {}

        // 创建 skeleton 和 animation state
        var skeleton = new spine.Skeleton(selNode.skeletonData);
        var animStateData = new spine.AnimationStateData(selNode.skeletonData);
        var animState = new spine.AnimationState(animStateData);

        // 设置姿态
        skeleton.setToSetupPose();
        skeleton.updateWorldTransform();

        SMData._fullCanvasGL = gl;
        SMData._fullCanvasContext = context;
        SMData._fullCanvasRenderer = renderer;
        SMData._fullCanvasSkeleton = skeleton;
        SMData._fullCanvasState = animState;
    } catch (e) {
        console.warn('Full canvas init failed:', e);
    }
};

// 更新右侧画布显示当前步骤的动画
SMTool._updateFullCanvasForStep = function () {
    var canvas = document.getElementById('flpFullCanvas');
    var renderer = SMData._fullCanvasRenderer;
    var skeleton = SMData._fullCanvasSkeleton;
    var animState = SMData._fullCanvasState;
    var gl = SMData._fullCanvasGL;

    if (!canvas || !renderer || !skeleton || !animState || !gl) {
        // 回退到 2D 文字显示
        SMTool._drawFullCanvasFallback();
        return;
    }

    var pb = SMData._fullPlayback;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || pb.currentStep >= path.nodes.length) return;

    var stepNode = path.nodes[pb.currentStep];
    var animName = stepNode.anim;

    // 检查动画是否存在
    var sd = skeleton.data;
    var animExists = false;
    for (var ai = 0; ai < sd.animations.length; ai++) {
        if (sd.animations[ai].name === animName) { animExists = true; break; }
    }
    if (!animExists) return;

    try {
        var cw = canvas.clientWidth || 260;
        var ch = canvas.clientHeight || 200;
        
        // 清除
        gl.viewport(0, 0, cw, ch);
        gl.clearColor(0.12, 0.12, 0.14, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 设置动画
        animState.setAnimation(0, animName, false);
        animState.update(0);
        animState.apply(skeleton);
        skeleton.updateWorldTransform();

        // 渲染
        renderer.camera.position.set(cw / 2, ch / 2, 0);
        renderer.camera.viewportWidth = cw;
        renderer.camera.viewportHeight = ch;
        renderer.camera.update();
        renderer.begin();
        try {
            if (renderer.drawSkeleton.length >= 2) {
                renderer.drawSkeleton(skeleton, true);
            } else {
                renderer.drawSkeleton(skeleton);
            }
        } catch (e2) {
            renderer.drawSkeleton(skeleton);
        }
        if (typeof renderer.end === 'function') {
            renderer.end();
        }
    } catch (e) {
        // WebGL 错误时回退
    }
};

// 2D 回退显示
SMTool._drawFullCanvasFallback = function () {
    var canvas = document.getElementById('flpFullCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var w = canvas.clientWidth || 260;
    var h = canvas.clientHeight || 200;
    canvas.width = w;
    canvas.height = h;

    var pb = SMData._fullPlayback;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || pb.currentStep >= path.nodes.length) return;

    var stepNode = path.nodes[pb.currentStep];
    var animName = stepNode.anim;

    ctx.fillStyle = '#1a1a1d';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(animName, w / 2, h / 2);

    ctx.fillStyle = 'rgba(74, 158, 255, 0.7)';
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('步骤 ' + (pb.currentStep + 1) + ' / ' + path.nodes.length, w / 2, h - 20);
};

// 选择完整路径
SMTool._selectFullPath = function (pathIdx) {
    SMData._fullPlayback.activePathIdx = pathIdx;
    SMData._fullPlayback.currentStep = 0;
    SMData._fullPlayback.isPlaying = false;
    if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._initFullCanvas();
    SMTool._updateFullCanvasForStep();
    SMTool._updateSel();
    SMTool._updateStateRowColors();
};

// 开始播放
SMTool._startFullPlayback = function () {
    var pb = SMData._fullPlayback;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || path.nodes.length === 0) return;
    pb.currentStep = 0;
    pb.isPlaying = true;
    SMTool._playFullStep();
};

// 暂停播放
SMTool._pauseFullPlayback = function () {
    SMData._fullPlayback.isPlaying = false;
    if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
};

// 播放当前步骤
SMTool._playFullStep = function () {
    var pb = SMData._fullPlayback;
    if (!pb.isPlaying) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || pb.currentStep >= path.nodes.length) {
        pb.isPlaying = false;
        return;
    }

    var stepNode = path.nodes[pb.currentStep];

    // 跳过闭环节点（虚线框），直接结束播放
    if (stepNode.cycleClose) {
        pb.isPlaying = false;
        SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
        SMTool._updateSel();
        SMTool._updateStateRowColors();
        return;
    }

    var spineNode = SMData.nodes.get(stepNode.id);
    if (spineNode && spineNode.state && spineNode.skeleton) {
        // 播放该节点的动画
        var animName = stepNode.anim;
        if (spineNode.skeletonData) {
            var found = false;
            for (var ai = 0; ai < spineNode.skeletonData.animations.length; ai++) {
                if (spineNode.skeletonData.animations[ai].name === animName) {
                    found = true;
                    break;
                }
            }
            if (found) {
                spineNode.state.setAnimation(0, animName, false);
                spineNode.currentAnim = animName;
            }
        }
    }

    // 更新面板高亮和画布焦点
    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();
    SMTool._updateEl(spineNode);
    SMTool._updateFullCanvasForStep();

    // 获取动画时长来自动推进
    var duration = 1000; // 默认1秒
    if (spineNode && spineNode.skeletonData) {
        for (var di = 0; di < spineNode.skeletonData.animations.length; di++) {
            if (spineNode.skeletonData.animations[di].name === stepNode.anim) {
                duration = spineNode.skeletonData.animations[di].duration * 1000;
                break;
            }
        }
    }

    pb._timer = setTimeout(function () {
        pb.currentStep++;
        if (pb.currentStep < path.nodes.length) {
            SMTool._playFullStep();
        } else {
            pb.isPlaying = false;
            SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
        }
    }, duration);
};

// 更新完整动画组的高亮（画布同步）
SMTool._updateFullHighlight = function () {
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();
};
