/* ================================================================
   AI 可读动画流 JSON 导出 v2
   以"组"为最大组织单元，组内按排序索引排列
   动画流路径中的状态按流程顺序排列，不暴露画布内部 ID
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 找出所有源头节点（无入边连线）和孤立节点 ----
SMTool._findAllSourceNodes = function () {
    var hasIncoming = {};
    var hasOutgoing = {};
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        hasIncoming[r.value.id] = false;
        r = nodesIter.next();
    }
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (hasIncoming.hasOwnProperty(c.toNode)) hasIncoming[c.toNode] = true;
        hasOutgoing[c.fromNode] = true;
    }
    var sources = [];
    var isolated = [];
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        var node = r2.value;
        var nid = node.id;
        if (!hasIncoming[nid]) {
            if (hasOutgoing[nid]) sources.push({ id: nid, nodeType: node.nodeType });
            else isolated.push({ id: nid, nodeType: node.nodeType });
        }
        r2 = nodesIter2.next();
    }
    return { sources: sources, isolated: isolated };
};

// ---- 计算组的排序索引（与 _renderGroupBoxes 逻辑一致） ----
// 返回 { groupId: "1" | "2" | "2_2" | ... }
SMTool._computeGroupSortIndices = function () {
    var groupBounds = [];
    for (var i = 0; i < SMData.groups.length; i++) {
        var g = SMData.groups[i];
        var bb = SMTool._getGroupBounds(g);
        if (bb) groupBounds.push({ g: g, bb: bb });
    }
    groupBounds.sort(function (a, b) {
        var dY = a.bb.top - b.bb.top;
        if (Math.abs(dY) < 0.5) return a.bb.left - b.bb.left;
        return dY;
    });
    var sortMap = {};
    var currentBase = 0;
    var currentBaseTop = -Infinity;
    var sameRowCount = 0;
    var THRESHOLD = 50;
    for (var si = 0; si < groupBounds.length; si++) {
        var item = groupBounds[si];
        if (si === 0 || Math.abs(item.bb.top - currentBaseTop) > THRESHOLD) {
            currentBase++;
            currentBaseTop = item.bb.top;
            sameRowCount = 1;
            sortMap[item.g.id] = '' + currentBase;
        } else {
            sameRowCount++;
            sortMap[item.g.id] = currentBase + '_' + sameRowCount;
        }
    }
    return sortMap;
};

// ---- 获取节点的显示名称 ----
SMTool._aiNodeDisplayName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return '入口';
    if (node.nodeType === 'exit') return '出口';
    if (node.nodeType === 'titleText') return node._textContent || '标题';
    var transName = SMTool._translateName(node.currentAnim);
    if (transName && transName !== node.currentAnim) return transName;
    return node.name || '';
};

// ---- 获取节点代表的动画状态名 ----
SMTool._aiStateName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return 'entry';
    if (node.nodeType === 'exit') return 'exit';
    if (node.nodeType === 'shortText' || node.nodeType === 'textBox') return '(文本)';
    if (node.nodeType === 'titleText') return '(标题)';
    if (node.nodeType === 'layer') return '(层级)';
    return node.currentAnim || (node.animations && node.animations.length > 0 ? node.animations[0].name : node.name);
};

// ---- 获取截图引用路径列表 ----
SMTool._aiShotRefs = function (shotRefs, name) {
    if (!shotRefs || !shotRefs[name]) return [];
    var raw = shotRefs[name];
    var arr = Array.isArray(raw) ? raw : [raw];
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] && typeof arr[i] === 'string') result.push(arr[i]);
    }
    return result;
};

// ---- 检查是否有标记内容 ----
SMTool._aiIsMarked = function (tags, notes, screenshots, shotRefs, fade, name) {
    if (tags && tags[name] && Array.isArray(tags[name]) && tags[name].length > 0) return true;
    if (notes && notes[name] && typeof notes[name] === 'string' && notes[name].trim().length > 0) return true;
    if (screenshots && screenshots[name]) {
        var ss = screenshots[name];
        if (Array.isArray(ss) && ss.length > 0) return true;
        if (typeof ss === 'number') return true;
    }
    if (SMTool._aiShotRefs(shotRefs, name).length > 0) return true;
    if (fade && fade[name] && fade[name].enabled) return true;
    return false;
};

// ---- 构建标记项详情 ----
SMTool._aiBuildMarkedDetail = function (name, tags, notes, shotRefs, fade) {
    var tagsArr = (tags && tags[name]) ? tags[name] : [];
    if (!Array.isArray(tagsArr)) tagsArr = tagsArr ? [tagsArr] : [];
    var noteText = (notes && notes[name]) ? notes[name] : '';
    var fadeData = (fade && fade[name]) || { enabled: false, duration: 1.0 };
    var shotRefsArr = SMTool._aiShotRefs(shotRefs, name);
    return {
        tags: tagsArr,
        note: noteText,
        screenshots: shotRefsArr,
        fadeInOut: {
            enabled: fadeData.enabled || false,
            durationSeconds: fadeData.duration || 1.0
        }
    };
};

// ---- 序列化单个状态为 step（sourceFile 和 stateName 置顶） ----
SMTool._serializeStepForAI = function (node) {
    var obj = {};

    if (node.nodeType === 'spine') {
        // ★ 源文件名
        obj.sourceFile = node.sourceFile || '';
        // ★ 状态名（英文 + 中文翻译 紧邻）
        obj.stateName = node.currentAnim || '';
        obj.chineseTranslation = SMTool._translateName(node.currentAnim) || node.currentAnim || '';
        // 显示名 + 类型
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.nodeType = 'spine';
        var animDur = 0;
        for (var ai = 0; ai < node.animations.length; ai++) {
            if (node.animations[ai].name === node.currentAnim) { animDur = node.animations[ai].duration; break; }
        }
        obj.animationDurationSeconds = animDur;
        obj.loopMode = node.loop !== false ? '循环播放' : '单次播放';
        obj.premultipliedAlpha = node.premultipliedAlpha || false;
        obj.currentSkin = node.currentSkin || '';
        obj.stateDescription = node._stateDesc || '';

        if (!node.tracks || node.tracks.length === 0) SMTool._initDefaultTracks(node);
        obj.trackMixing = [];
        for (var ti = 0; ti < node.tracks.length; ti++) {
            var t = node.tracks[ti];
            obj.trackMixing.push({
                trackIndex: ti,
                animationName: t.animName || '',
                alpha: (t.alpha !== undefined ? t.alpha : 1.0),
                mixBlend: t.mixBlend || 'replace',
                mixDurationSeconds: (t.mixDuration !== undefined ? t.mixDuration : 0),
                loop: t.loop !== false,
                enabled: t.enabled !== false
            });
        }

        var skinsArr = [];
        for (var ski = 0; ski < (node.skins || []).length; ski++) {
            var skn = node.skins[ski];
            if (SMTool._aiIsMarked(node._skinTags, node._skinNotes, node._skinScreenshots, node._skinShotRefs, node._skinFade, skn)) {
                var sd = SMTool._aiBuildMarkedDetail(skn, node._skinTags, node._skinNotes, node._skinShotRefs, node._skinFade);
                sd.skinName = skn;
                skinsArr.push(sd);
            }
        }
        if (skinsArr.length > 0) obj.skins = skinsArr;

        var bonesArr = [];
        for (var bi = 0; bi < (node.bones || []).length; bi++) {
            var bn = node.bones[bi];
            if (SMTool._aiIsMarked(node._boneTags, node._boneNotes, node._boneScreenshots, node._boneShotRefs, node._boneFade, bn)) {
                var bd = SMTool._aiBuildMarkedDetail(bn, node._boneTags, node._boneNotes, node._boneShotRefs, node._boneFade);
                bd.boneName = bn;
                bonesArr.push(bd);
            }
        }
        if (bonesArr.length > 0) obj.bones = bonesArr;

        var slotsArr = [];
        for (var sli = 0; sli < (node.slots || []).length; sli++) {
            var sln = node.slots[sli];
            if (SMTool._aiIsMarked(node._slotTags, node._slotNotes, node._slotScreenshots, node._slotShotRefs, node._slotFade, sln)) {
                var sld = SMTool._aiBuildMarkedDetail(sln, node._slotTags, node._slotNotes, node._slotShotRefs, node._slotFade);
                sld.slotName = sln;
                slotsArr.push(sld);
            }
        }
        if (slotsArr.length > 0) obj.slots = slotsArr;

        SMTool._ensureEventFrames(node);
        if (node._eventFrames && node._eventFrames.length > 0) {
            obj.eventFrames = [];
            for (var efi = 0; efi < node._eventFrames.length; efi++) {
                obj.eventFrames.push({ timeSeconds: node._eventFrames[efi].time, eventName: node._eventFrames[efi].name });
            }
        }

        if (node._customScale && node._customScale !== 1.0) obj.customScale = node._customScale;

    } else if (node.nodeType === 'entry' || node.nodeType === 'exit') {
        obj.nodeType = node.nodeType;
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.entryExitText = node._exitText || '';
    } else if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
        obj.nodeType = node.nodeType;
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.textContent = node._textContent || '';
    } else if (node.nodeType === 'titleText') {
        obj.nodeType = 'titleText';
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.titleText = node._textContent || '';
    } else if (node.nodeType === 'layer') {
        obj.nodeType = 'layer';
        obj.displayName = SMTool._aiNodeDisplayName(node);
        var ld = SMTool._layerData(node);
        obj.layerCount = ld.layerCount || 0;
        obj.layers = [];
        for (var lj = 1; lj <= ld.layerCount; lj++) {
            var layerInfo = ld.layers[lj];
            var layerObj = { layerNumber: lj };
            if (layerInfo && layerInfo.animNodeId) {
                layerObj.connectedAnimationName = layerInfo.animName || '';
                var linkedNode = SMData.nodes.get(layerInfo.animNodeId);
                layerObj.connectedDisplayName = linkedNode ? SMTool._aiNodeDisplayName(linkedNode) : '';
            } else {
                layerObj.connectedAnimationName = '';
            }
            obj.layers.push(layerObj);
        }
    }
    return obj;
};

// ---- 序列化连线（仅保留条件文本，不暴露内部 ID） ----
SMTool._serializeConnForAI = function (connId) {
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (c.id === connId) return { condition: c.condition || '' };
    }
    return { condition: '' };
};

// ---- 为一个源头构建所有动画流（每个 path 一个独立的自包含流） ----
SMTool._buildFlowsForSource = function (srcNode, startFlowIdx) {
    var paths = SMTool._findAllFullPaths(srcNode.id);
    var flowsOut = [];

    if (paths.length === 0) {
        // 无下游路径 → 单节点流
        var srcLabel = SMTool._aiNodeDisplayName(srcNode);
        var srcSF = srcNode.sourceFile ? '[' + srcNode.sourceFile + '] ' : '';
        var soloFlow = {
            flowIndex: startFlowIdx,
            flowExpression: srcSF + srcLabel + '（无下游）',
            isCycle: false,
            steps: [SMTool._serializeStepForAI(srcNode)]
        };
        soloFlow.steps[0].stepIndex = 0;
        flowsOut.push(soloFlow);
        return flowsOut;
    }

    for (var pk = 0; pk < paths.length; pk++) {
        var pathData = paths[pk];
        var flowIdx = startFlowIdx + pk;

        // 构建 flowExpression（含源文件名标注）
        var exprParts = [];
        for (var si = 0; si < pathData.nodes.length; si++) {
            var nd = SMData.nodes.get(pathData.nodes[si].id);
            var label = nd ? SMTool._aiNodeDisplayName(nd) : (pathData.nodes[si].anim || '?');
            // ★ 标注动画文件名
            var sf = (nd && nd.sourceFile) ? '[' + nd.sourceFile + '] ' : '';
            exprParts.push(sf + label);
            if (si < pathData.nodes.length - 1) {
                var connPre = SMTool._serializeConnForAI(pathData.conns[si]);
                exprParts.push('→ (' + (connPre.condition || '无条件') + ') →');
            }
        }

        var flowObj = {
            flowIndex: flowIdx,
            flowExpression: exprParts.join(' '),
            isCycle: false,
            steps: []
        };

        var lastNode = pathData.nodes[pathData.nodes.length - 1];
        if (lastNode && lastNode.cycleClose) flowObj.isCycle = true;

        // 内联所有 node 参数 + transition 条件到 steps
        for (var sti = 0; sti < pathData.nodes.length; sti++) {
            var sn = pathData.nodes[sti];
            var stepNode = SMData.nodes.get(sn.id);

            var stepObj = SMTool._serializeStepForAI(stepNode || { nodeType: 'spine', name: sn.anim || '?', currentAnim: sn.anim || '', animations: [] });
            stepObj.stepIndex = sti;
            stepObj.isCycleClose = sn.cycleClose || false;
            flowObj.steps.push(stepObj);

            if (sti < pathData.nodes.length - 1 && sti < pathData.conns.length) {
                var connObj = SMTool._serializeConnForAI(pathData.conns[sti]);
                connObj.kind = 'transition';
                flowObj.steps.push(connObj);
            }
        }

        flowsOut.push(flowObj);
    }
    return flowsOut;
};

// ================================================================
//   主导出：exportAIJson() v2 — 以组为最大单元，每个动画流自包含
// ================================================================
SMTool.exportAIJson = function () {
    if (SMData.nodes.size === 0) { SMTool._showSaveToast('画布无节点，无法导出'); return; }

    var groupSortMap = SMTool._computeGroupSortIndices();

    var nodeGroupMap = {};
    for (var gi = 0; gi < SMData.groups.length; gi++) {
        var grp = SMData.groups[gi];
        var arr = [];
        grp.nodeIds.forEach(function (nid) { arr.push(nid); });
        for (var ni = 0; ni < arr.length; ni++) {
            nodeGroupMap[arr[ni]] = { groupId: grp.id, groupObj: grp };
        }
    }

    var sourceResult = SMTool._findAllSourceNodes();
    var allSources = sourceResult.sources;
    var allIsolated = sourceResult.isolated;

    var groupSources = {};
    var ungroupedSources = [];
    var ungroupedIsolated = [];

    for (var si = 0; si < allSources.length; si++) {
        var src = allSources[si];
        var info = nodeGroupMap[src.id];
        if (info) {
            var gid = info.groupId;
            if (!groupSources[gid]) groupSources[gid] = { groupObj: info.groupObj, sortIdx: groupSortMap[gid] || '?', sources: [], isolated: [] };
            groupSources[gid].sources.push(src);
        } else {
            ungroupedSources.push(src);
        }
    }
    for (var ii = 0; ii < allIsolated.length; ii++) {
        var iso = allIsolated[ii];
        var info2 = nodeGroupMap[iso.id];
        if (info2) {
            var gid2 = info2.groupId;
            if (!groupSources[gid2]) groupSources[gid2] = { groupObj: info2.groupObj, sortIdx: groupSortMap[gid2] || '?', sources: [], isolated: [] };
            groupSources[gid2].isolated.push(iso);
        } else {
            ungroupedIsolated.push(iso);
        }
    }

    var groupIds = Object.keys(groupSources);
    groupIds.sort(function (a, b) {
        var sa = groupSources[a].sortIdx;
        var sb = groupSources[b].sortIdx;
        var na = parseFloat(sa) || 0;
        var nb = parseFloat(sb) || 0;
        if (na !== nb) return na - nb;
        return (sa || '').localeCompare(sb || '');
    });

    var totalFlows = 0;
    var groupFlowIdx = 0;
    var groupsOutput = [];

    // 辅助：为孤立节点创建单节点流
    var _makeIsoFlow = function (node) {
        groupFlowIdx++;
        var sfLabel = (node.sourceFile) ? '[' + node.sourceFile + '] ' : '';
        return {
            flowIndex: groupFlowIdx,
            flowExpression: sfLabel + SMTool._aiNodeDisplayName(node) + '（独立，无连线）',
            isCycle: false,
            steps: [SMTool._serializeStepForAI(node)]
        };
    };

    for (var gi2 = 0; gi2 < groupIds.length; gi2++) {
        var gid = groupIds[gi2];
        var gs = groupSources[gid];
        var grp = gs.groupObj;
        var flowsArr = [];

        // 组内的源头 → 构建动画流（每个 path 一个独立流）
        for (var sj = 0; sj < gs.sources.length; sj++) {
            var srcNode = SMData.nodes.get(gs.sources[sj].id);
            if (!srcNode) continue;
            var newFlows = SMTool._buildFlowsForSource(srcNode, groupFlowIdx + 1);
            groupFlowIdx += newFlows.length;
            for (var nf = 0; nf < newFlows.length; nf++) flowsArr.push(newFlows[nf]);
        }
        // 组内的孤立节点
        for (var ik = 0; ik < gs.isolated.length; ik++) {
            var isoNode = SMData.nodes.get(gs.isolated[ik].id);
            if (!isoNode) continue;
            var isoFlow = _makeIsoFlow(isoNode);
            if (isoFlow.steps[0]) isoFlow.steps[0].stepIndex = 0;
            flowsArr.push(isoFlow);
        }

        if (flowsArr.length === 0) continue;
        totalFlows += flowsArr.length;

        groupsOutput.push({
            sortIndex: gs.sortIdx,
            title: grp.title || '',
            color: grp.color || '',
            nodeCount: grp.nodeIds ? grp.nodeIds.size : 0,
            animationFlows: flowsArr
        });
    }

    // 未打组的节点
    var ungroupedFlows = [];
    for (var uj = 0; uj < ungroupedSources.length; uj++) {
        var usrcNode = SMData.nodes.get(ungroupedSources[uj].id);
        if (!usrcNode) continue;
        var uFlows = SMTool._buildFlowsForSource(usrcNode, groupFlowIdx + 1);
        groupFlowIdx += uFlows.length;
        for (var nf2 = 0; nf2 < uFlows.length; nf2++) ungroupedFlows.push(uFlows[nf2]);
    }
    for (var uk = 0; uk < ungroupedIsolated.length; uk++) {
        var uisoNode = SMData.nodes.get(ungroupedIsolated[uk].id);
        if (!uisoNode) continue;
        var uisoFlow = _makeIsoFlow(uisoNode);
        if (uisoFlow.steps[0]) uisoFlow.steps[0].stepIndex = 0;
        ungroupedFlows.push(uisoFlow);
    }
    totalFlows += ungroupedFlows.length;

    var result = {
        exportType: 'ai_animation_flow_documentation',
        exportVersion: '2.0',
        exportDate: new Date().toISOString(),
        projectSummary: {
            totalGroups: SMData.groups.length,
            totalAnimationFlows: totalFlows,
            renderMode: SMData.renderMode || 'perf',
            flowMode: SMData.flowMode || 'full'
        },
        groups: groupsOutput
    };
    if (ungroupedFlows.length > 0) result.ungrouped = { animationFlows: ungroupedFlows };

    var jsonStr = JSON.stringify(result, null, 2);
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'animation-flow-ai.json';
    a.click();
    URL.revokeObjectURL(url);
    SMTool._showSaveToast('已导出 AI JSON v2 到本地（下载目录）', 'animation-flow-ai.json（' + groupsOutput.length + ' 组, ' + totalFlows + ' 个动画流）');
};

// ================================================================
// AI 动画流程交换格式 v3
// 目标：同时提供“机器可执行的规范化图”和“人/AI 可快速阅读的路径摘要”。
// v3 导出严格只读，不会为了补默认值而修改画布节点。
// ================================================================

SMTool._aiV3StableId = function (prefix, value) {
    return prefix + ':' + String(value === undefined || value === null ? 'unknown' : value);
};

SMTool._aiV3Clone = function (value, fallback) {
    if (value === undefined || value === null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return fallback; }
};

SMTool._aiV3GroupForNode = function (nodeId) {
    for (var i = 0; i < (SMData.groups || []).length; i++) {
        var group = SMData.groups[i];
        if (group.nodeIds && group.nodeIds.has && group.nodeIds.has(nodeId)) return group;
        if (Array.isArray(group.nodeIds) && group.nodeIds.indexOf(nodeId) >= 0) return group;
    }
    return null;
};

SMTool._aiV3CollectKeys = function () {
    var seen = {};
    for (var ai = 0; ai < arguments.length; ai++) {
        var value = arguments[ai];
        if (Array.isArray(value)) {
            for (var vi = 0; vi < value.length; vi++) seen[value[vi]] = true;
        } else if (value && typeof value === 'object') {
            var keys = Object.keys(value);
            for (var ki = 0; ki < keys.length; ki++) seen[keys[ki]] = true;
        }
    }
    return Object.keys(seen).sort();
};

SMTool._aiV3ScreenshotRefs = function (refs, name) {
    var raw = refs && refs[name];
    var arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    var out = [];
    for (var i = 0; i < arr.length; i++) if (typeof arr[i] === 'string' && arr[i]) out.push(arr[i]);
    return out;
};

SMTool._aiV3SerializeAnnotationCategory = function (names, tags, notes, fade, refs, mounted) {
    var keys = SMTool._aiV3CollectKeys(names, tags, notes, fade, refs, mounted);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        var name = keys[i];
        var tagValue = tags && tags[name];
        var tagList = Array.isArray(tagValue) ? tagValue.slice() : (tagValue ? [tagValue] : []);
        var fadeValue = fade && fade[name] ? fade[name] : {};
        var screenshots = SMTool._aiV3ScreenshotRefs(refs, name);
        var mountMap = mounted && mounted[name] ? mounted[name] : {};
        var mountStates = [];
        for (var si = 0; si < screenshots.length; si++) mountStates.push(mountMap[si] !== false);
        if (tagList.length === 0 && !(notes && notes[name]) && !fadeValue.enabled && screenshots.length === 0) continue;
        out.push({
            name: name,
            tags: tagList,
            note: (notes && notes[name]) || '',
            fade: {
                enabled: !!fadeValue.enabled,
                durationSeconds: Number(fadeValue.duration) || 0
            },
            screenshots: screenshots.map(function (ref, index) {
                return { reference: ref, mountedInAnimation: mountStates[index] !== false };
            })
        });
    }
    return out;
};

SMTool._aiV3RegisterResource = function (node, build) {
    var sourceNames = SMTool._aiV3Clone(node._srcFileNames, []);
    if (!Array.isArray(sourceNames)) sourceNames = sourceNames ? [sourceNames] : [];
    var texturePages = [];
    var textureSources = node._srcTexDataUrls || [];
    for (var ti = 0; ti < textureSources.length; ti++) {
        texturePages.push({
            pageIndex: ti,
            fileName: textureSources[ti] && textureSources[ti].name ? textureSources[ti].name : ('texture-' + ti + '.png'),
            contentEmbeddedInProject: !!(textureSources[ti] && textureSources[ti].dataUrl)
        });
    }
    if (texturePages.length === 0 && node._srcTexDataUrl) {
        texturePages.push({ pageIndex: 0, fileName: sourceNames[2] || 'texture.png', contentEmbeddedInProject: true });
    }
    var resourceKey = [node.sourceFile || '', node.version || node._spineVer || '', node._srcType || 'json', sourceNames.join('|')].join('||');
    if (build.resourceIds[resourceKey]) return build.resourceIds[resourceKey];
    var resourceId = SMTool._aiV3StableId('resource', build.resources.length + 1);
    build.resourceIds[resourceKey] = resourceId;
    build.resources.push({
        id: resourceId,
        kind: 'spine-skeleton-package',
        logicalName: node.sourceFile || node.name || resourceId,
        spineVersion: node.version || node._spineVer || 'unknown',
        skeletonFormat: node._srcType === 'skel' ? 'binary-skel' : 'json',
        files: {
            originalFileNames: sourceNames,
            skeletonFile: sourceNames[0] || (node.sourceFile || ''),
            atlasFile: sourceNames[1] || '',
            texturePages: texturePages
        },
        availability: {
            skeletonContentEmbeddedInProject: !!(node._srcSkelJson || node._srcSkelBinBase64),
            atlasContentEmbeddedInProject: !!node._srcAtlasText,
            textureContentEmbeddedInProject: texturePages.length > 0,
            exportedInThisJson: false
        },
        loadingContract: {
            preserveAtlasPageOrder: true,
            preserveSpineRuntimeVersion: true,
            premultipliedAlphaIsConfiguredPerNode: true
        }
    });
    return resourceId;
};

SMTool._aiV3SerializeTrackSequence = function (node) {
    var seqs = node._trackSequence || [];
    var out = [];
    for (var ti = 0; ti < seqs.length; ti++) {
        var seq = seqs[ti] || {};
        var clips = [];
        var srcClips = seq.animations || [];
        var cursor = 0;
        for (var ci = 0; ci < srcClips.length; ci++) {
            var clip = srcClips[ci] || {};
            var duration = SMTool._animationDurationSeconds ? SMTool._animationDurationSeconds(node, clip.name) : 0;
            var mixOut = Math.max(0, Number(clip.mixOut) || 0);
            clips.push({
                order: ci,
                animationName: clip.name || '',
                durationSeconds: duration,
                startsAtSeconds: cursor,
                mixToNextSeconds: mixOut,
                nextClipStartsAtSeconds: ci < srcClips.length - 1 ? cursor + Math.max(0, duration - Math.min(duration, mixOut)) : null
            });
            cursor += Math.max(0, duration - (ci < srcClips.length - 1 ? Math.min(duration, mixOut) : 0));
        }
        out.push({
            trackIndex: ti,
            enabled: seq.enabled !== false,
            alpha: seq.alpha !== undefined ? Number(seq.alpha) : 1,
            mixBlend: seq.mixBlend || 'replace',
            loopSequence: seq.loopSeq !== false,
            durationPerSequenceSeconds: SMTool._trackSequenceDurationSeconds ? SMTool._trackSequenceDurationSeconds(node, seq) : cursor,
            clips: clips
        });
    }
    return out;
};

SMTool._aiV3SerializeSpine = function (node, build) {
    var animations = [];
    for (var ai = 0; ai < (node.animations || []).length; ai++) {
        var animation = node.animations[ai] || {};
        animations.push({ name: animation.name || '', durationSeconds: Number(animation.duration) || 0 });
    }
    var mixPairs = [];
    var mixTable = node._mixTable || {};
    var mixKeys = Object.keys(mixTable).sort();
    for (var mi = 0; mi < mixKeys.length; mi++) {
        var parts = mixKeys[mi].split('→');
        mixPairs.push({
            fromAnimation: (parts[0] || '').trim(),
            toAnimation: (parts[1] || '').trim(),
            durationSeconds: Math.max(0, Number(mixTable[mixKeys[mi]]) || 0)
        });
    }
    var legacyTracks = [];
    for (var li = 0; li < (node.tracks || []).length; li++) {
        var legacy = node.tracks[li] || {};
        legacyTracks.push({
            trackIndex: li,
            animationName: legacy.animName || '',
            enabled: legacy.enabled !== false,
            alpha: legacy.alpha !== undefined ? Number(legacy.alpha) : 1,
            mixBlend: legacy.mixBlend || 'replace',
            mixDurationSeconds: Math.max(0, Number(legacy.mixDuration) || 0),
            loop: legacy.loop !== false
        });
    }
    var eventFrames = [];
    for (var ei = 0; ei < (node._eventFrames || []).length; ei++) {
        var eventFrame = node._eventFrames[ei] || {};
        eventFrames.push({
            timeSeconds: Number(eventFrame.time) || 0,
            eventName: eventFrame.name || '',
            note: (node._eventNotes && node._eventNotes[eventFrame.name]) || '',
            screenshotReferences: SMTool._aiV3ScreenshotRefs(node._eventShotRefs || {}, eventFrame.name)
        });
    }
    return {
        resourceId: SMTool._aiV3RegisterResource(node, build),
        stateDescription: node._stateDesc || '',
        animationCatalog: animations,
        selectedAnimation: node.currentAnim || '',
        skin: node.currentSkin || '',
        rendering: {
            premultipliedAlpha: !!node.premultipliedAlpha,
            customScale: node._customScale !== undefined ? Number(node._customScale) : 1,
            debugOffsetPixels: { x: Number(node._debugOffsetX) || 0, y: Number(node._debugOffsetY) || 0 },
            debugCanvasPixels: { width: Number(node._debugCanvasW) || 0, height: Number(node._debugCanvasH) || 0 }
        },
        playback: {
            speed: node._playbackSpeed !== undefined ? Number(node._playbackSpeed) : 1,
            direction: Number(node._playbackSpeed) < 0 ? 'reverse' : 'forward',
            loop: {
                enabled: node.loop !== false,
                mode: node._loopMode || 'single',
                count: node._loopCount !== undefined ? Number(node._loopCount) : 1,
                durationSeconds: node._loopTime !== undefined && node._loopTime !== null ? Number(node._loopTime) : null
            },
            stateMode: node._trackMode ? 'track-sequence' : 'single-animation',
            durationPerPassSeconds: node._trackMode && SMTool._trackNodeDurationSeconds ? SMTool._trackNodeDurationSeconds(node) : (SMTool._animationDurationSeconds ? SMTool._animationDurationSeconds(node, node.currentAnim) : 0),
            trackSequence: node._trackMode ? SMTool._aiV3SerializeTrackSequence(node) : [],
            legacySimultaneousTracks: legacyTracks,
            defaultMixTable: mixPairs
        },
        annotations: {
            bones: SMTool._aiV3SerializeAnnotationCategory(node.bones, node._boneTags, node._boneNotes, node._boneFade, node._boneShotRefs, node._boneShotMounted),
            skins: SMTool._aiV3SerializeAnnotationCategory(node.skins, node._skinTags, node._skinNotes, node._skinFade, node._skinShotRefs, null),
            slots: SMTool._aiV3SerializeAnnotationCategory(node.slots, node._slotTags, node._slotNotes, node._slotFade, node._slotShotRefs, node._slotShotMounted),
            events: eventFrames,
            nodeImageReferences: (node._nodeShotRefs || []).slice()
        }
    };
};

SMTool._aiV3LayerNumberForConnection = function (connection) {
    var layerNumber = Number(connection._layerNum) || 0;
    if (!layerNumber && typeof connection.fromState === 'string' && connection.fromState.indexOf('layer_') === 0) {
        layerNumber = parseInt(connection.fromState.replace('layer_', ''), 10) || 0;
    }
    return layerNumber || null;
};

SMTool._aiV3SerializePlaybackTree = function (tree) {
    if (!tree) return null;
    var out = { layerNodeId: SMTool._aiV3StableId('node', tree.layerNodeId), depth: tree.depth || 0, layers: [] };
    for (var i = 0; i < (tree.layers || []).length; i++) {
        var layer = tree.layers[i];
        out.layers.push({
            layerNumber: layer.layerNum,
            sequentialNodeIds: (layer.chainNodeIds || []).map(function (id) { return SMTool._aiV3StableId('node', id); }),
            nestedParallelNodeId: layer.subLayerNodeId ? SMTool._aiV3StableId('node', layer.subLayerNodeId) : null,
            nested: SMTool._aiV3SerializePlaybackTree(layer.subLayerTree)
        });
    }
    return out;
};

SMTool._aiV3SerializeLayerComposition = function (node) {
    var layerData = node._layerData || { layerCount: 2, layers: {} };
    var composition = {
        id: SMTool._aiV3StableId('parallel', node.id),
        nodeId: SMTool._aiV3StableId('node', node.id),
        scheduling: 'start-all-layers-simultaneously',
        completionBarrier: 'continue-only-after-all-layers-and-nested-compositions-complete',
        zOrderRule: 'smaller-layer-number-renders-on-top',
        positionRule: 'child-world-offset-equals-sum-of-ancestor-container-offsets-plus-local-offset',
        layers: []
    };
    for (var layerNumber = 1; layerNumber <= (layerData.layerCount || 0); layerNumber++) {
        var stored = layerData.layers && layerData.layers[layerNumber] ? layerData.layers[layerNumber] : {};
        var startNodeId = stored.animNodeId || null;
        for (var ci = 0; ci < SMData.connections.length; ci++) {
            var conn = SMData.connections[ci];
            if (conn.fromNode === node.id && SMTool._aiV3LayerNumberForConnection(conn) === layerNumber) {
                startNodeId = conn.toNode;
                break;
            }
        }
        composition.layers.push({
            layerNumber: layerNumber,
            renderOrder: layerNumber,
            startNodeId: startNodeId ? SMTool._aiV3StableId('node', startNodeId) : null,
            configuredAnimationName: stored.animName || '',
            containerOffsetPixels: {
                x: stored._containerOffset ? Number(stored._containerOffset.offX) || 0 : 0,
                y: stored._containerOffset ? Number(stored._containerOffset.offY) || 0 : 0
            },
            legacyPositionOffsetPixels: { x: Number(stored.posOffX) || 0, y: Number(stored.posOffY) || 0 },
            perNodeOffsetsByOriginalNodeId: SMTool._aiV3Clone(stored._chainPositions, {})
        });
    }
    if (typeof SMTool._buildPlaybackTree === 'function') {
        composition.recursiveExecutionTree = SMTool._aiV3SerializePlaybackTree(SMTool._buildPlaybackTree(node, 0));
    } else {
        composition.recursiveExecutionTree = null;
    }
    return composition;
};

SMTool._aiV3SerializeNode = function (node, build) {
    var group = SMTool._aiV3GroupForNode(node.id);
    var common = {
        id: SMTool._aiV3StableId('node', node.id),
        originalCanvasId: node.id,
        type: node.nodeType || 'unknown',
        name: node.name || '',
        displayName: SMTool._aiNodeDisplayName ? SMTool._aiNodeDisplayName(node) : (node.name || ''),
        canvas: {
            positionPixels: { x: Number(node.x) || 0, y: Number(node.y) || 0 },
            scale: node._customScale !== undefined ? Number(node._customScale) : 1,
            groupId: group ? SMTool._aiV3StableId('group', group.id) : null
        },
        // 编辑器没有独立的游戏空间变换输入，必须明确标记为“未创作”，禁止 AI
        // 把流程画布坐标直接当成 Unity/Godot/Cocos 的世界坐标。
        runtimeTransform: {
            authored: false,
            position: null,
            rotationDegrees: null,
            scale: null,
            anchorNormalized: null,
            sortingLayer: null,
            editorCanvasFallback: { x: Number(node.x) || 0, y: Number(node.y) || 0 }
        },
        semantics: {}
    };
    if (node.nodeType === 'spine') {
        common.semantics = { kind: 'spine-animation-state', spine: SMTool._aiV3SerializeSpine(node, build) };
    } else if (node.nodeType === 'layer') {
        common.semantics = { kind: 'parallel-composition', compositionId: SMTool._aiV3StableId('parallel', node.id) };
    } else if (node.nodeType === 'delayer' || node.nodeType === 'progDelayer') {
        common.semantics = {
            kind: node.nodeType === 'progDelayer' ? 'program-delay' : 'visual-delay',
            durationSeconds: node._delayValue !== undefined ? Number(node._delayValue) : 1,
            blocksCurrentBranch: true
        };
    } else if (node.nodeType === 'hider') {
        common.semantics = {
            kind: 'visibility-control',
            durationSeconds: node._hideValue !== undefined ? Number(node._hideValue) : -1,
            direction: node._hideDirection || 'left',
            permanentWhenDurationIsMinusOne: true,
            branchTimeContinuesWhileHidden: true
        };
    } else if (node.nodeType === 'loop') {
        common.semantics = { kind: 'flow-loop', behavior: 'jump-to-current-flow-entry' };
    } else if (node.nodeType === 'entry' || node.nodeType === 'exit') {
        common.semantics = { kind: node.nodeType, text: node._exitText || '' };
    } else if (node.nodeType === 'shortText' || node.nodeType === 'textBox' || node.nodeType === 'titleText') {
        common.semantics = {
            kind: 'documentation',
            style: node.nodeType,
            text: node._textContent || '',
            lineBreakCharacterIndices: (node._lineBreakPositions || []).slice()
        };
    } else if (node.nodeType === 'image') {
        common.semantics = { kind: 'reference-image', contentEmbeddedInProject: !!node._imageDataUrl };
    } else {
        common.semantics = { kind: 'unknown', rawNodeType: node.nodeType || '' };
    }
    return common;
};

SMTool._aiV3SerializeEdge = function (connection) {
    var rawCondition = connection.condition || '';
    var layerNumber = SMTool._aiV3LayerNumberForConnection(connection);
    return {
        id: SMTool._aiV3StableId('edge', connection.id),
        originalCanvasId: connection.id,
        from: {
            nodeId: SMTool._aiV3StableId('node', connection.fromNode),
            port: connection.fromState || 'output',
            parallelLayerNumber: layerNumber
        },
        to: {
            nodeId: SMTool._aiV3StableId('node', connection.toNode),
            port: connection.toState || 'input'
        },
        condition: {
            kind: rawCondition.trim() ? 'user-authored-expression' : 'always',
            raw: rawCondition,
            ast: null,
            evaluationContract: rawCondition.trim() ? 'Host engine must evaluate this expression using project-defined variables.' : 'Always eligible.'
        },
        visual: {
            color: connection.color || '',
            bezierControlPointsCanvasPixels: [
                { x: Number(connection.cp1x) || 0, y: Number(connection.cp1y) || 0 },
                { x: Number(connection.cp2x) || 0, y: Number(connection.cp2y) || 0 }
            ]
        }
    };
};

// 将规范化画布图投影为更接近游戏引擎的协议层。
// 所有字段都来自现有数据；无法确定的实例、外部事件和游戏坐标显式标记为未创作。
SMTool._aiV3BuildGameProtocol = function (nodes, edges, resources, diagnostics) {
    var nodeById = {};
    var outgoing = {};
    for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].id] = nodes[ni];
    for (var ei = 0; ei < edges.length; ei++) {
        var edge = edges[ei];
        if (!outgoing[edge.from.nodeId]) outgoing[edge.from.nodeId] = [];
        outgoing[edge.from.nodeId].push(edge);
    }

    var entityByResource = {};
    var entities = [];
    var states = [];
    var timelineEvents = [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.type !== 'spine' || !node.semantics.spine) continue;
        var spine = node.semantics.spine;
        var entity = entityByResource[spine.resourceId];
        if (!entity) {
            entity = {
                id: SMTool._aiV3StableId('entity', spine.resourceId),
                resourceId: spine.resourceId,
                logicalRole: node.name || node.displayName || '',
                stateNodeIds: [],
                instanceModel: {
                    authoringStatus: 'not-authored',
                    explicitInstances: [],
                    runtimePolicy: 'Create independent mutable instances for every concurrently active use; never share AnimationState.'
                }
            };
            entityByResource[spine.resourceId] = entity;
            entities.push(entity);
        }
        entity.stateNodeIds.push(node.id);
        var stateId = SMTool._aiV3StableId('state', node.originalCanvasId);
        states.push({
            id: stateId,
            entityId: entity.id,
            sourceNodeId: node.id,
            name: node.name || node.displayName || stateId,
            animation: spine.selectedAnimation,
            skin: spine.skin,
            playback: SMTool._aiV3Clone(spine.playback, {}),
            rendering: SMTool._aiV3Clone(spine.rendering, {}),
            intent: spine.stateDescription || ''
        });
        var events = spine.annotations && spine.annotations.events ? spine.annotations.events : [];
        for (var evi = 0; evi < events.length; evi++) {
            timelineEvents.push({
                id: 'event:spine:' + node.originalCanvasId + ':' + evi,
                kind: 'spine-timeline-event',
                sourceNodeId: node.id,
                stateId: stateId,
                name: events[evi].eventName,
                timeSeconds: events[evi].timeSeconds,
                note: events[evi].note || ''
            });
        }
    }

    var transitions = [];
    var sourcePriority = {};
    for (var ti = 0; ti < edges.length; ti++) {
        var transitionEdge = edges[ti];
        var source = nodeById[transitionEdge.from.nodeId];
        var priority = sourcePriority[transitionEdge.from.nodeId] || 0;
        sourcePriority[transitionEdge.from.nodeId] = priority + 1;
        var trigger = 'source-node-complete';
        if (source) {
            if (source.type === 'entry') trigger = 'flow-start';
            else if (source.type === 'delayer' || source.type === 'progDelayer') trigger = 'delay-complete';
            else if (source.type === 'hider') trigger = 'visibility-command-applied';
            else if (source.type === 'layer') trigger = 'parallel-barrier-complete';
            else if (source.type === 'loop') trigger = 'loop-command';
            else if (source.type === 'spine') trigger = 'animation-state-complete';
        }
        transitions.push({
            id: SMTool._aiV3StableId('transition', transitionEdge.originalCanvasId),
            sourceEdgeId: transitionEdge.id,
            fromNodeId: transitionEdge.from.nodeId,
            toNodeId: transitionEdge.to.nodeId,
            trigger: trigger,
            guard: SMTool._aiV3Clone(transitionEdge.condition, {}),
            priority: priority,
            isFallback: transitionEdge.condition.kind === 'always',
            failurePolicyWhenGuardIsFalse: 'evaluate-next-transition-by-priority'
        });
    }

    var sourceIds = Object.keys(outgoing);
    for (var si = 0; si < sourceIds.length; si++) {
        var sourceEdges = outgoing[sourceIds[si]];
        var hasConditional = false;
        var hasFallback = false;
        for (var oi = 0; oi < sourceEdges.length; oi++) {
            if (sourceEdges[oi].condition.kind === 'always') hasFallback = true;
            else hasConditional = true;
        }
        if (hasConditional && !hasFallback) {
            diagnostics.push({
                severity: 'warning',
                code: 'CONDITIONAL_BRANCH_WITHOUT_FALLBACK',
                nodeId: sourceIds[si],
                message: 'All outgoing transitions are conditional. If every guard is false, execution stops and reports no eligible transition.'
            });
        }
    }

    if (entities.length > 0) {
        diagnostics.push({ severity: 'warning', code: 'INSTANCE_MODEL_NOT_AUTHORED', message: 'The canvas does not define named/countable game-object instances; entities contain state candidates only.' });
        diagnostics.push({ severity: 'warning', code: 'RUNTIME_TRANSFORMS_NOT_AUTHORED', message: 'Game-space position, anchor and sorting layer are not authored. Editor canvas coordinates are fallback visualization data only.' });
        diagnostics.push({ severity: 'warning', code: 'EXTERNAL_EVENTS_NOT_AUTHORED', message: 'Click, server-response and gameplay events are not authored as first-class inputs; only Spine timeline events and transition guards are exported.' });
    }

    return {
        protocolName: 'AI Game Animation Protocol',
        protocolVersion: '1.0-draft',
        coverage: {
            resources: 'complete-from-project',
            animationStates: 'complete-from-canvas',
            transitions: 'complete-from-canvas-edges',
            spineTimelineEvents: 'complete-when-runtime-data-is-loaded',
            externalGameplayEvents: 'not-authored',
            objectInstances: 'not-authored',
            runtimeTransforms: 'not-authored',
            failureBranches: 'explicit-fallback-edges-or-stop-policy'
        },
        entities: entities,
        states: states,
        transitions: transitions,
        events: {
            timelineEvents: timelineEvents,
            externalEventDefinitions: [],
            missingInputPolicy: 'Do not invent triggers. Ask the author or bind them in the target project.'
        },
        bindings: {
            genericSpineRuntime: {
                trackSequence: 'setAnimation(trackIndex, firstClip) then addAnimation(trackIndex, remainingClips)',
                parallel: 'one independent Skeleton and AnimationState per concurrent instance'
            },
            targetEngineHints: [
                { engine: 'Unity', mapping: 'Spine-Unity AnimationState plus generated flow controller' },
                { engine: 'Godot 4', mapping: 'Spine runtime extension plus generated state/flow controller' },
                { engine: 'Cocos Creator', mapping: 'sp.Skeleton track APIs plus generated TypeScript flow controller' }
            ]
        },
        runtimeRules: {
            noEligibleTransition: 'stop-current-flow-and-report',
            concurrentStateIsolation: true,
            preserveRawConditions: true,
            useExactSpineRuntimeVersion: true,
            editorCoordinatesAreNotGameCoordinates: true
        }
    };
};

SMTool._aiV3BuildFlowSummaries = function (nodes, edges, entryIds, diagnostics) {
    var outgoing = {};
    for (var ei = 0; ei < edges.length; ei++) {
        var edge = edges[ei];
        if (!outgoing[edge.from.nodeId]) outgoing[edge.from.nodeId] = [];
        outgoing[edge.from.nodeId].push(edge);
    }
    var nodeById = {};
    for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].id] = nodes[ni];
    var flows = [];
    var LIMIT = 500;
    function walk(nodeId, nodePath, edgePath) {
        if (flows.length >= LIMIT) return;
        var cycleAt = nodePath.indexOf(nodeId);
        if (cycleAt >= 0) {
            flows.push({
                flowIndex: flows.length + 1,
                nodeIds: nodePath.concat([nodeId]),
                edgeIds: edgePath,
                isCycle: true,
                cycleReturnsToNodeId: nodeId
            });
            return;
        }
        var nextNodePath = nodePath.concat([nodeId]);
        var nextEdges = outgoing[nodeId] || [];
        if (nextEdges.length === 0 || nextNodePath.length >= 100) {
            flows.push({ flowIndex: flows.length + 1, nodeIds: nextNodePath, edgeIds: edgePath, isCycle: false, cycleReturnsToNodeId: null });
            return;
        }
        for (var i = 0; i < nextEdges.length; i++) {
            walk(nextEdges[i].to.nodeId, nextNodePath, edgePath.concat([nextEdges[i].id]));
        }
    }
    for (var ii = 0; ii < entryIds.length; ii++) walk(entryIds[ii], [], []);
    if (flows.length >= LIMIT) diagnostics.push({ severity: 'warning', code: 'FLOW_SUMMARY_TRUNCATED', message: 'Readable path summaries were limited to ' + LIMIT + '; normalized graph remains complete.' });
    for (var fi = 0; fi < flows.length; fi++) {
        var labels = [];
        for (var pi = 0; pi < flows[fi].nodeIds.length; pi++) {
            var flowNode = nodeById[flows[fi].nodeIds[pi]];
            labels.push(flowNode ? (flowNode.displayName || flowNode.name || flowNode.id) : flows[fi].nodeIds[pi]);
        }
        flows[fi].expression = labels.join(' → ');
    }
    return flows;
};

SMTool._validateAIExportV3 = function (document) {
    var diagnostics = (document.validation && document.validation.diagnostics) ? document.validation.diagnostics.slice() : [];
    var nodeIds = {};
    var resourceIds = {};
    for (var ri = 0; ri < document.resources.length; ri++) resourceIds[document.resources[ri].id] = true;
    for (var ni = 0; ni < document.graph.nodes.length; ni++) {
        var node = document.graph.nodes[ni];
        nodeIds[node.id] = true;
        if (node.type === 'spine') {
            var spine = node.semantics.spine;
            if (!resourceIds[spine.resourceId]) diagnostics.push({ severity: 'error', code: 'MISSING_RESOURCE', nodeId: node.id, message: 'Spine node references an unknown resource.' });
            if (!spine.resourceId || spine.animationCatalog.length === 0) diagnostics.push({ severity: 'warning', code: 'INCOMPLETE_SPINE_DATA', nodeId: node.id, message: 'Spine animation catalog or resource metadata is incomplete.' });
            var catalog = {};
            for (var ai = 0; ai < spine.animationCatalog.length; ai++) catalog[spine.animationCatalog[ai].name] = true;
            var tracks = spine.playback.trackSequence || [];
            for (var ti = 0; ti < tracks.length; ti++) {
                for (var ci = 0; ci < tracks[ti].clips.length; ci++) {
                    if (!catalog[tracks[ti].clips[ci].animationName]) diagnostics.push({ severity: 'error', code: 'UNKNOWN_TRACK_ANIMATION', nodeId: node.id, message: 'Track references missing animation: ' + tracks[ti].clips[ci].animationName });
                }
            }
        }
    }
    for (var ei = 0; ei < document.graph.edges.length; ei++) {
        var edge = document.graph.edges[ei];
        if (!nodeIds[edge.from.nodeId] || !nodeIds[edge.to.nodeId]) diagnostics.push({ severity: 'error', code: 'DANGLING_EDGE', edgeId: edge.id, message: 'Edge endpoint does not exist.' });
    }
    document.validation.diagnostics = diagnostics;
    document.validation.status = diagnostics.some(function (item) { return item.severity === 'error'; }) ? 'invalid' : (diagnostics.length ? 'valid-with-warnings' : 'valid');
    return document.validation;
};

SMTool._buildAIExportDocumentV3 = function () {
    var build = { resources: [], resourceIds: {}, diagnostics: [] };
    var nodes = [];
    var parallelCompositions = [];
    var nodeIterator = SMData.nodes.values();
    var nextNode = nodeIterator.next();
    while (!nextNode.done) {
        var node = nextNode.value;
        nodes.push(SMTool._aiV3SerializeNode(node, build));
        if (node.nodeType === 'layer') parallelCompositions.push(SMTool._aiV3SerializeLayerComposition(node));
        nextNode = nodeIterator.next();
    }
    nodes.sort(function (a, b) { return Number(a.originalCanvasId) - Number(b.originalCanvasId); });

    var edges = [];
    for (var ei = 0; ei < SMData.connections.length; ei++) edges.push(SMTool._aiV3SerializeEdge(SMData.connections[ei]));
    edges.sort(function (a, b) { return Number(a.originalCanvasId) - Number(b.originalCanvasId); });

    var incoming = {};
    var outgoing = {};
    for (var ci = 0; ci < edges.length; ci++) {
        incoming[edges[ci].to.nodeId] = true;
        outgoing[edges[ci].from.nodeId] = true;
    }
    var entryIds = [];
    var exitIds = [];
    for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni].type === 'entry' || !incoming[nodes[ni].id]) entryIds.push(nodes[ni].id);
        if (nodes[ni].type === 'exit' || !outgoing[nodes[ni].id]) exitIds.push(nodes[ni].id);
    }

    var groupSortMap = {};
    try { groupSortMap = SMTool._computeGroupSortIndices(); } catch (e) {}
    var groups = [];
    for (var gi = 0; gi < (SMData.groups || []).length; gi++) {
        var group = SMData.groups[gi];
        var groupNodeIds = [];
        if (group.nodeIds && group.nodeIds.forEach) group.nodeIds.forEach(function (id) { groupNodeIds.push(SMTool._aiV3StableId('node', id)); });
        groups.push({
            id: SMTool._aiV3StableId('group', group.id),
            originalCanvasId: group.id,
            title: group.title || '',
            color: group.color || '',
            sortIndex: groupSortMap[group.id] || null,
            nodeIds: groupNodeIds
        });
    }

    var document = {
        format: 'spine-preview-ai-animation-flow',
        formatVersion: '3.0.0',
        schema: './schemas/ai-animation-flow-v3.schema.json',
        metadata: {
            generatedAt: new Date().toISOString(),
            generator: 'Spine Preview Animation Flow Editor',
            language: 'zh-CN',
            purpose: 'Portable, AI-readable animation flow specification for high-fidelity game-engine reconstruction.'
        },
        units: {
            time: 'seconds',
            canvasPosition: 'CSS pixels in editor world space',
            previewOffset: 'preview canvas pixels',
            angles: 'degrees',
            normalizedAlphaRange: [0, 1]
        },
        coordinateSystem: {
            editorCanvas: { origin: 'top-left', xAxis: 'right', yAxis: 'down' },
            spineSkeleton: { origin: 'asset-defined', xAxis: 'right', yAxis: 'up' },
            conversionRule: 'Keep editor layout coordinates separate from Spine skeleton coordinates.'
        },
        resourcePackaging: {
            mode: 'external-companion-files',
            binaryPayloadsIncludedInJson: false,
            exactReconstructionRequirement: 'Provide the original skeleton, atlas and texture files listed in resources together with this JSON.'
        },
        resources: build.resources,
        canvas: {
            view: SMTool._aiV3Clone(SMData.view, { x: 0, y: 0, zoom: 1 }),
            showGrid: SMData.showGrid !== false,
            renderMode: SMData.renderMode || 'static',
            flowMode: SMData.flowMode || 'full',
            groups: groups
        },
        graph: {
            nodes: nodes,
            edges: edges,
            entryNodeIds: entryIds,
            exitNodeIds: exitIds
        },
        executionModel: {
            graphTraversal: 'Start at an entry node. Evaluate eligible outgoing edge conditions. Follow the selected edge to the next node.',
            conditionPrecedence: 'If multiple conditions are true, preserve edge array order unless the host supplies an explicit policy.',
            animationState: 'Each UI track maps to the same-index Spine AnimationState track. Clips on one track use setAnimation followed by addAnimation.',
            mixing: 'mixToNextSeconds belongs to the current clip. The next clip starts currentDuration-mixToNextSeconds after the current clip starts.',
            parallel: 'All layers start together and join at a completion barrier. Nested parallel compositions obey the same rule recursively.',
            visibility: 'Visibility control suppresses drawing only; branch time and completion continue advancing.',
            unknownConditionPolicy: 'Do not guess variables or operators. Preserve condition.raw and request the host game to bind its expression context.'
        },
        parallelCompositions: parallelCompositions,
        gameProtocol: null,
        readableFlowSummaries: [],
        reconstructionGuide: {
            targetFidelity: '100% when the exact Spine runtime versions and all companion assets are available; otherwise structural/logic fidelity only.',
            orderedImplementationSteps: [
                'Load resources using each resource.spineVersion and preserve atlas texture page order.',
                'Create one runtime state per graph Spine node or per concurrent parallel instance.',
                'Apply skin, PMA, scale, speed, loop and annotation-driven visual settings.',
                'Build each track sequence with native Spine AnimationState queues and the exported overlap timings.',
                'Implement graph conditions without changing their raw expressions.',
                'Instantiate parallel compositions recursively; never share mutable playback state between concurrent instances.',
                'Advance invisible layers normally and release the barrier only when every nested branch completes.',
                'Use canvas groups, positions, edge curves and labels to reproduce the editor visualization when an authoring UI is required.'
            ],
            fidelityConstraints: [
                'The JSON intentionally does not embed binary/image payloads.',
                'A user-authored condition cannot be executed until the host binds its variables and expression evaluator.',
                'Runtime-specific physics behavior requires the exact exported Spine runtime version.'
            ]
        },
        validation: { status: 'not-run', diagnostics: [] }
    };
    document.gameProtocol = SMTool._aiV3BuildGameProtocol(nodes, edges, build.resources, build.diagnostics);
    document.readableFlowSummaries = SMTool._aiV3BuildFlowSummaries(nodes, edges, entryIds, build.diagnostics);
    document.validation.diagnostics = build.diagnostics;
    SMTool._validateAIExportV3(document);
    return document;
};

// v3 主导出覆盖旧入口；保留上方 v2 辅助函数仅用于旧工程兼容和界面显示。
SMTool.exportAIJson = function () {
    if (SMData.nodes.size === 0) { SMTool._showSaveToast('画布无节点，无法导出'); return; }
    var documentV3 = SMTool._buildAIExportDocumentV3();
    var jsonStr = JSON.stringify(documentV3, null, 2);
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'animation-flow-ai-v3.json';
    anchor.click();
    URL.revokeObjectURL(url);
    var summary = documentV3.graph.nodes.length + ' 节点, ' + documentV3.graph.edges.length + ' 连线, ' + documentV3.parallelCompositions.length + ' 个并行模块';
    SMTool._showSaveToast('已导出 AI JSON v3 到本地（下载目录）', 'animation-flow-ai-v3.json（' + summary + '）');
};
