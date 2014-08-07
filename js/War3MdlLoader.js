(function(THREE) {

function isBlankChar(c) {
	return !c || ' \r\n\t'.indexOf(c) >= 0
}
function isSeperateChar(c) {
	return ',:{}'.indexOf(c) >= 0
}
function getWords(text, index) {
	var words = [ ],
		c = '',
		d = ''
	while (c = text[index]) {
		if (c == '/' && text[index+1] == '/') {
			// skip comments
			while ((d = text[index+1]) && d != '\n') index ++
		}
		else if (isBlankChar(c)) {
			// skip blank chars
		}
		else if (isSeperateChar(c)) {
			// split word
			words.push(c)
		}
		else if (c == '"') {
			var begin = ++index
			// get quoted word
			while ((d = text[index]) && d != '"') index ++
			words.push(text.substr(begin, index - begin))
		}
		else {
			var begin = index ++
			// get word
			while ((d = text[index]) && !isBlankChar(d) && !isSeperateChar(d)) index ++
			words.push(text.substr(begin, index - begin))
			// fall back
			index --
		}
		index ++
	}
	return words
}
function getObject(words, index) {
	if (!words.index)
		words.index = 0
	if (words[words.index] == '{')
		words.index ++
	var begin = words.index,
		object = [ ],
		w = ''
	while ((w = words[words.index]) !== undefined ) {
		if (w == '{') {
			var key = words.slice(begin, words.index)
			key.push(getObject(words))
			object.push(key)
			// continue
			begin = words.index
			continue
		}
		else if (w == ',') {
			var key = words.slice(begin, words.index)
			if (key.length)
				object.push(key.length > 1 ? key : key[0])
			words.index ++
			// continue
			begin = words.index
			continue
		}
		else if (w == '}') {
			var key = words.slice(begin, words.index)
			if (key.length)
				object.push(key.length > 1 ? key : key[0])
			// skip the ending '}'
			words.index ++
			// skip next comma
			if (words[words.index] == ',')
				words.index ++
			break
		}
		words.index ++
	}
	return object
}

function newTexture(type, data) {
	var texture = { }
	if (type == 'Bitmap')
		texture.path = data[0][1]
	return texture
}
function newMaterial(data) {
	var material = { },
		layer = null
	// FIXME: only consider the first layer
	for (var j = 0, e = null; e = data[j]; j ++) {
		if (e[0] == 'Layer') {
			layer = e
			break
		}
	}
	// FIXME: more properties should be processed
	for (var j = 0, e = null; e = layer[1][j]; j ++) {
		if (e == 'TwoSided')
			material.TwoSided = true
		else if (e[0] == 'static' && e[1] == 'TextureID')
			material.TextureID = parseInt(e[2])
	}
	return material
}
function newAnimation(name, data) {
	var animation = { }
	animation.name = name
	animation.loop = true
	for (var j = 0, e = null; e = data[j]; j ++) {
		if (e[0] == 'Interval') {
			animation.begin = parseInt(e[1][0])
			animation.end = parseInt(e[1][1])
		}
		else if (e == 'NonLooping') {
			animation.loop = false
		}
	}
	return animation
}
function newGlobalAnim(id, duration) {
	return {
		gid: id,
		name: 'Global Animation - '+id,
		begin: 0,
		end: parseInt(duration)
	}
}
var FACE_MASK = {
	quad: 1,
	materials: 2,
	uvs: 4,
	vertex_uvs: 8,
	normals: 16,
	vertex_normals: 32,
	colors: 64,
	vertex_colors: 128
}
function flatenVector(object) {
	var array = [ ]
	for (var i = 0, d = null; d = object[i]; i ++) {
		for(var j = 0, e = null; e = d[0][j]; j ++) {
			array.push(parseFloat(e))
		}
	}
	return array
}
function flatenSkinIndex(object, influencesPerVertex, skinIndices, allBones) {
	var bonesUsed = [ ]
	function getBoneIndex(id) {
		var k = '#' + id
		if (bonesUsed[k] === undefined) {
			bonesUsed[k] = bonesUsed.length
			bonesUsed.push(id)
		}
		return bonesUsed[k]
	}

	var array = [ ]
	for (var i = 0, d = null; d = object[i]; i ++) {
		var id = parseFloat(d),
			bids = skinIndices[id][1].map(parseFloat)
		for (var j = 0; j < influencesPerVertex; j ++) {
			var id = bids[j % bids.length]
			array.push(getBoneIndex(id))
		}
	}

	bonesUsed.slice().forEach(function(id) {
		while ((id = allBones['#'+id].parent) >= 0)
			getBoneIndex(id)
	})

	allBones.used = bonesUsed.map(function(id) {
		var bone = { }, origin = allBones['#' + id]
		for (var k in origin)
			bone[k] = origin[k]
		bone.rpos = bone.pos.slice()

		var parent = allBones['#' + bone.parent]
		if (parent) {
			bone.rpos[0] = bone.pos[0] - parent.pos[0]
			bone.rpos[1] = bone.pos[1] - parent.pos[1]
			bone.rpos[2] = bone.pos[2] - parent.pos[2]
		}

		bone.parent = bonesUsed['#' + bone.parent]
		if (bone.parent === undefined)
			bone.parent = -1

		return bone
	})

	return array
}
function addFaces(array, object, flags) {
	var c = flags & FACE_MASK.quad ? 4 : 3
	// FIXME: only vertex_uvs & vertex_normals is supported
	for (var i = 0; i < object.length; i += c) {
		array.push(flags)
		for (var j = 0; j < c; j ++)
			array.push(parseInt(object[i + j]))
		if (flags && FACE_MASK.vertex_uvs)
			for (var j = 0; j < c; j ++)
				array.push(parseInt(object[i + j]))
		if (flags && FACE_MASK.vertex_normals)
			for (var j = 0; j < c; j ++)
				array.push(parseInt(object[i + j]))
	}
}
function interpValue(prev, next, frame, type) {
	if (type == 'DontInterp')
		return prev.value.slice()

	var f = (frame - prev.frame) / (next.frame - prev.frame),
		g = 1 - f
		v = [ ]
	for (var i = 0; i < prev.value.length; i ++)
		v.push(prev.value[i] * g + next.value[i] * f)
	return v
}
function interpArray(array, frame) {
	var first = array[0],
		last = array[array.length - 1]
	if (frame <= first.frame)
		return first.value.slice()
	else if (frame >= last.frame)
		return last.value.slice()

	for (var i = 0; i < array.length; i ++)
		if (array[i].frame > frame) break
	var prev = array[i - 1],
		next = array[i]
	if (prev && next)
		return interpValue(prev, next, frame, array.type)
}
function getKeys(bone, begin, end, gid) {
	function getFiltered(list, frames) {
		var sel = [ ]
		if (gid >= 0 && gid !== list.gid)
			return sel
		for (var i = 0, d = null; d = list[i]; i ++)
			if (d.frame >= begin && d.frame <= end) {
				frames[d.frame] = true
				sel.push(d)
			}
		return sel
	}

	var frames = { }
	frames[begin] = true
	frames[end] = true
	var rotations = getFiltered(bone.rotations, frames)
		translations = getFiltered(bone.translations, frames)

	var sortedFrames = [ ]
	for (var frame in frames)
		sortedFrames.push(parseInt(frame))
	sortedFrames.sort(function(a, b) {
		return a - b
	})

	var keys = [ ]
	for (var i = 0; i < sortedFrames.length; i ++) {
		var frame = sortedFrames[i]
		keys.push({
			frame: frame,
			trans: translations.length ? interpArray(translations, frame) : [0, 0, 0],
			rot: rotations.length ? interpArray(rotations, frame) : [0, 0, 0, 1],
			scl: [1, 1, 1]
		})
	}
	keys.keyFrames = Math.max(translations.length, rotations.length)
	return keys
}
function newBone(name, data, pivots) {
	var bone = { }
	bone.name = name.replace(/ /g, '_')
	bone.rotations = [ ]
	bone.translations = [ ]
	for (var i = 0, d = null; d = data[i]; i ++) {
		if (d[0] == 'ObjectId') {
			bone.id = parseInt(d[1])
			bone.pos = pivots[bone.id][0].map(parseFloat)
		}
		else if (d[0] == 'Parent') {
			bone.parent = parseInt(d[1])
		}
		// the GeosetId attribute is not reliable, ignoring it
		/*
		else if (d[0] == 'GeosetId')
			bone.target = parseInt(d[1])
		*/
		else if (d[0] == 'Rotation' || d[0] == 'Translation') {
			var ls = d[0] == 'Rotation' ? bone.rotations : bone.translations
			for (var j = 0, e = null; e = d[2][j]; j ++) {
				if (e[0] == 'Linear')
					ls.type = e[0]
				else if (e[0] == 'GlobalSeqId')
					ls.gid = parseInt(e[1])
				else if (e[1] == ':') ls.push({
					frame: parseInt(e[0]),
					value: e[2].map(parseFloat)
				})
			}
		}
	}
	return bone
}
function newAnim(bones, animation) {
	var anim = { }
	anim.global = animation.gid >= 0
	anim.name = animation.name
	anim.loop = animation.loop
	anim.fps = 30
	anim.length = (animation.end - animation.begin) / 1000
	anim.hierarchy = [ ]
	anim.keyFrames = 0
	anim.beginFrame = animation.begin
	for (var i = 0, d = null; d = bones[i]; i ++) {
		var ks = getKeys(d, animation.begin, animation.end, animation.gid)
		anim.keyFrames = Math.max(anim.keyFrames, ks.keyFrames)
		for (var j = 0, e; e = ks[j]; j ++) {
			// set time
			e.time = (e.frame - animation.begin) / 1000
			// must convert to relative positions here
			e.pos = [ ]
			e.pos[0] = e.trans[0] + d.rpos[0]
			e.pos[1] = e.trans[1] + d.rpos[1]
			e.pos[2] = e.trans[2] + d.rpos[2]
		}
		anim.hierarchy.push({
			keys: ks
		})
	}
	return anim
}
function newGeoAnim(data) {
	// FIXME: only alpha is supported
	var anim = { }
	anim.alpha = [ ]
	for (var i = 0, d = null; d = data[i]; i ++) {
		if (d[0] == 'GeosetId') {
			anim.target = parseInt(d[1])
		}
		else if (d[0] == 'Alpha') {
			for (var j = 0, e; e = d[2][j]; j ++) {
				if (e[0] == 'Linear' || e[0] == 'DontInterp')
					anim.alpha.type == e[0]
				else if (e[1] == ':') anim.alpha.push({
					frame: parseInt(e[0]),
					value: [parseFloat(e[2])]
				})
			}
		}
	}
	return anim
}
function getGeometryJson(id, data, allBones, animations) {
	var json = {
		metadata: {
			formatVersion: 3.1,
			vertices:      0,
			faces:         0,
			normals:       0,
			colors:        0,
			uvs:           0,
			materials:     0,
			morphTargets:  0,
			bones:         0,
		},
		scale: 1,
		materials:    [ ],
		vertices:     [ ],
		morphTargets: [ ],
		normals:      [ ],
		colors:       [ ],
		uvs:          [ ],
		faces:        [ ],
		bones:        [ ],
		skinIndices:  [ ],
		skinWeights:  [ ],
		animations:   [ ],

		// not used by three.js
		extra: {
			MaterialID: undefined,
			GlobalAnims: [ ]
		}
	}

	// setup skin indices
	var skinIndices = [ ]
	for (var i = 0, d = null; d = data[i]; i ++) {
		if (d[0] == 'Groups') {
			skinIndices = d[3]
			json.influencesPerVertex = 1
			for (var j = 0, e = null; e = skinIndices[j]; j ++)
				json.influencesPerVertex = Math.max(e[1].length, json.influencesPerVertex)
		}
	}

	for (var i = 0, d = null; d = data[i]; i ++) {
		if (d[0] == 'Vertices') {
			json.metadata.vertices = parseInt(d[1])
			json.vertices = flatenVector(d[2])
		}
		else if (d[0] == 'Normals') {
			json.metadata.normals = parseInt(d[1])
			json.normals = flatenVector(d[2])
		}
		else if (d[0] == 'TVertices') {
			json.metadata.uvs = parseInt(d[1])
			json.uvs = [flatenVector(d[2])]
		}
		else if (d[0] == 'VertexGroup') {
			json.skinIndices = flatenSkinIndex(d[1], json.influencesPerVertex, skinIndices, allBones)
			json.skinWeights = json.skinIndices.map(function() { return 1 })
		}
		else if (d[0] == 'Faces') {
			json.metadata.faces = parseInt(d[2]) / 3
			for (var j = 0, e = null; e = d[3][j]; j ++) {
				// FIXME: support trangles only
				if (e[0] == 'Triangles') {
					addFaces(json.faces, e[1][0][0],
						(json.uvs.length && FACE_MASK.vertex_uvs) |
						(json.normals.length && FACE_MASK.vertex_normals))
				}
			}
		}
		else if (d[0] == 'MaterialID') {
			json.extra.MaterialID = parseInt(d[1])
		}
	}

	var bones = allBones.used
	json.metadata.bones = bones.length

	// set json bones
	for (var i = 0, d = null; d = bones[i]; i ++) {
		json.bones.push({
			name: d.name,
			parent: d.parent,
			pos: d.rpos,
			rotq: [0, 0, 0, 1],
		})
	}

	// setup animations
	for (var i = 0, d; d = animations[i]; i ++) {
		var anim = newAnim(bones, d)
		if (anim.global)
			json.extra.GlobalAnims.push(anim)
		else
			json.animations.push(anim)
	}

	return json
}

THREE.LoadWar3Mdl = function(url, callback) {
	$.get(url, function(text) {
		var words = getWords(text, 0),
			object = getObject(words),
			geometries = [ ]

		// Bones and helpers require pivot points for their positions
		var pivots = [ ]
		for (var i = 0, o = null; o = object[i]; i ++) {
			if (o[0] == 'PivotPoints') {
				pivots = o[2]
			}
		}

		// Geosets require Bones to build the geometry
		var bones = [ ],
			animations = [ ],
			geoAnims = [ ],
			textures = [ ],
			materials = [ ]
		for (var i = 0, o = null; o = object[i]; i ++) {
			if (o[0] == 'Sequences') o[2].forEach(function(d) {
				if (d[0] == 'Anim')
					animations.push(newAnimation(d[1], d[2]))
			})
			else if (o[0] == 'GlobalSequences') o[2].forEach(function(d, i) {
				// do not known why there are so many "Duration 0"
				if (d[0] == 'Duration' && parseInt(d[1]) > 0)
					animations.push(newGlobalAnim(i, d[1]))
			})
			else if (o[0] == 'Textures') o[2].forEach(function(d) {
				textures.push(newTexture(d[0], d[1]))
			})
			else if (o[0] == 'Materials') o[2].forEach(function(d) {
				if (d[0] == 'Material')
					materials.push(newMaterial(d[1]))
			})
			else if (o[0] == 'GeosetAnim') {
				geoAnims.push(newGeoAnim(o[1]))
			}
			else if (o[0] == 'Bone' || o[0] == 'Helper') {
				var bone = newBone(o[1], o[2], pivots)
				bones.push(bone)
				bones['#' + bone.id] = bone
			}
		}

		// create geometry
		var geometries = [ ]
		for (var i = 0, o = null; o = object[i]; i ++) {
			if (o[0] == 'Geoset') {
				var geoId = geometries.length,
					data = getGeometryJson(geoId, o[1], bones, animations),
					loader = new THREE.JSONLoader(),
					result = loader.parse(data),
					geo = result.geometry

				geo.extra = data.extra
				if (materials[data.extra.MaterialID]) {
					var m = materials[data.extra.MaterialID],
						t = textures[m.TextureID]
					geo.extra.TwoSided = m.TwoSided
					geo.extra.TexturePath = t && t.path
				}

				geometries.push(geo)
			}
		}

		geometries.geoAnims = geoAnims
		callback(geometries, animations)
	})
}

function simpleClone(data) {
	var clone = { }
	for (var k in data)
		clone[k] = data[k]
	return clone
}

THREE.W3Character = function(geometries) {
	this.root = new THREE.Object3D()

	for (var i = 0, geo; geo = geometries[i]; i ++) {
		var mat = geo.MaterialCache
		if (!mat) {
			if (geo.extra.TexturePath) {
				var texture = THREE.ImageUtils.loadTexture(geo.extra.TexturePath, new THREE.UVMapping())
				texture.flipY = false
				mat = new THREE.MeshPhongMaterial({ map:texture, alphaTest:0.5, side:geo.extra.TwoSided ? THREE.DoubleSide : THREE.FrontSide })
			}
			else {
				mat = new THREE.MeshBasicMaterial()
			}
			mat.skinning = true
			// cache the material
			geo.MaterialCache = mat
		}

		var mesh = new THREE.SkinnedMesh(geo, mat)
		this.root.add(mesh)

		// Note: normal weight blending is not correct, still looking for a new solution
		// setup global animation
		geo.extra.GlobalAnims.forEach(function(anim) {
			if (anim.keyFrames > 1)
				new THREE.Animation(mesh, simpleClone(anim)).play(0)
		})
	}

	this.playAnimation = function(name) {
		this.root.children.forEach(function(mesh) {
			if (!mesh.animations)
				mesh.animations = { }
			if (!mesh.animList)
				mesh.animList = [ ]
			var anim = mesh.animPlaying
			// Note: name may be an array (or object)
			if (name && typeof name !== 'string') {
				// if current playing is in the name object, then continue current animation
				if (anim) {
					if (anim.lastTime < anim.currentTime) {
						var n = anim.data.name
						if (name[n] >= 0 || name.indexOf(n) >= 0)
							name = n
					}
					anim.lastTime = anim.currentTime
				}
				// if name is an array, start a random animation in it
				if (name.forEach) {
					name = name[Math.floor(Math.random() * name.length)]
				}
			}
			if (!mesh.animations[name]) {
				if (mesh.geometry && mesh.geometry.animations) for (var i = 0, d; d = mesh.geometry.animations[i]; i ++) {
					if (d && d.name == name) {
						var a = mesh.animations[name] = new THREE.Animation(mesh, simpleClone(d))
						mesh.animList.push(a)
						break
					}
				}
			}
			if (anim !== mesh.animations[name]) {
				if (anim)
					anim.weightDelta = -1/0.3
				if (anim = mesh.animPlaying = mesh.animations[name]) {
					anim.weightDelta =  1/0.3
					anim.play(anim.currentTime, anim.weight)
				}
			}
		})
	}

	this.updateAnimation = function(dt) {
		this.root.children.forEach(function(mesh) {
			if (mesh.animList) for (var i = 0, anim; anim = mesh.animList[i]; i ++) {
				if (anim.weightDelta) {
					anim.weight += anim.weightDelta * dt
					if (anim.weight > 1) {
						anim.weight = 1
						anim.weightDelta = 0
					}
					else if (anim.weight < 0) {
						anim.weight = 0
						anim.weightDelta = 0
						anim.stop()
					}
				}
			}
		})
	}

	this.updateGeoAnim = function(dt) {
		for (var i = 0, a; a = geometries.geoAnims[i]; i ++) {
			var mesh = this.root.children[a.target],
				anim = mesh.animPlaying
			if (anim) {
				// FIXME: only alpha is enabled
				mesh.material.opacity = a.alpha.length > 0 ?
					interpArray(a.alpha, anim.data.beginFrame + anim.currentTime*1000) : 1
			}
		}
	}

	this.beforeRender = function(dt) {
		this.updateAnimation(dt)
		this.updateGeoAnim(dt)
	}
}

})(this.THREE || require('three'))