/**
 * GaussianSplatMesh.fork.js — spike fork of vendor/GaussianSplatMesh.js (task 5).
 *
 * Four titled edits over the vendored dev-branch addon; everything else is
 * byte-identical upstream code (H-FORK: with no fork option used, behavior
 * equals the vendor copy). Titled patches:
 *
 *  [capacity]   `{ capacity }` option: allocate the four vec4 storage buffers +
 *               packed SH at a fixed splat capacity from empty arrays,
 *               instanceCount = capacity. splatGeometry supplies only the SH
 *               degree and the (caller-maintained) boundingSphere.
 *  [uploadPage] `uploadPage( slot, page )`: subarray writes into a 65,536-splat
 *               page + `addUpdateRange` + `needsUpdate`. The partial-upload path
 *               exists in published 0.185.1 (three.webgpu.js:81159 WebGPU,
 *               :67098 WebGL — both honor updateRanges and clear them after
 *               consumption); `assertPartialUploadConsumed()` verifies that at
 *               runtime and falls back to full-buffer uploads, recording it.
 *  [selection]  selection via `center.w` (0 = deselected → degenerate quad in
 *               the vertex node; CountingSort untouched). `setSelection( slot,
 *               flags )` rewrites the w lane of one page.
 *  [invalidate] `invalidate()`: explicit sort + SH invalidation. Nothing updates
 *               by itself — arrivals under a motionless camera must still appear
 *               (H-LOAD criteria 9–10).
 */
import {
	BufferAttribute,
	InstancedBufferGeometry,
	Matrix4,
	Mesh,
	NodeMaterial,
	StorageBufferAttribute,
	Vector2,
	Vector3
} from 'three/webgpu';

import {
	Discard,
	Fn,
	If,
	atan,
	cameraProjectionMatrix,
	cos,
	dot,
	exp,
	float,
	highpModelViewMatrix,
	instanceIndex,
	max,
	min,
	normalize,
	positionGeometry,
	screenSize,
	sin,
	sqrt,
	storage,
	uint,
	uniform,
	varyingProperty,
	vec2,
	vec3,
	vec4
} from 'three/tsl';

import { CountingSort } from '../vendor/CountingSort.js';
import {
	SH_BAND_COMPONENTS,
	SH_BAND_WORDS,
	createPackedSphericalHarmonicsBand,
	getSphericalHarmonicsDegree
} from '../vendor/GaussianSplatUtils.js';

const BIN_COUNT = 4096;
const WORKGROUP_SIZE = 256;
const SORT_DIRECTION_THRESHOLD = 0.9995;
const SORT_POSITION_THRESHOLD = 0.0025;
const KERNEL_2D_SIZE = 0.3;
const MAX_SCREEN_SPACE_SPLAT_SIZE = 1024;
const CLIP_XY = 1.4;

// [uploadPage] page geometry — must match PagePool.PAGE_SIZE.
const PAGE_SIZE = 65536;

const _worldCenter = /*@__PURE__*/ new Vector3();
const _viewCenter = /*@__PURE__*/ new Vector3();
const _worldScale = /*@__PURE__*/ new Vector3();
const _cameraPosition = /*@__PURE__*/ new Vector3();
const _cameraDirection = /*@__PURE__*/ new Vector3();
const _sortDepthRange = /*@__PURE__*/ new Vector2();
const _worldMatrixInverse = /*@__PURE__*/ new Matrix4();

class GaussianSplatMesh extends Mesh {

	constructor( splatGeometry, { autoSort = true, capacity = null } = {} ) {

		const positionAttribute = splatGeometry.getAttribute( 'position' );
		const covarianceAttribute = splatGeometry.getAttribute( 'covariance' );
		const colorAttribute = splatGeometry.getAttribute( 'color' );
		const sphericalHarmonicsDegree = getSphericalHarmonicsDegree( splatGeometry );

		// [capacity] fixed-capacity mode sizes everything from `capacity`, not the source geometry.
		const count = capacity !== null ? capacity : positionAttribute.count;

		if ( splatGeometry.boundingBox === null ) splatGeometry.computeBoundingBox();
		if ( splatGeometry.boundingSphere === null ) splatGeometry.computeBoundingSphere();

		const geometry = createGeometry( count );
		const buffers = capacity !== null ?
			createEmptyStorageBuffers( count, sphericalHarmonicsDegree ) :
			createStorageBuffers( count, positionAttribute.array, covarianceAttribute.array, colorAttribute.array, {
				degree: sphericalHarmonicsDegree,
				sh1: sphericalHarmonicsDegree >= 1 ? splatGeometry.getAttribute( 'sphericalHarmonics1' ).array : undefined,
				sh2: sphericalHarmonicsDegree >= 2 ? splatGeometry.getAttribute( 'sphericalHarmonics2' ).array : undefined,
				sh3: sphericalHarmonicsDegree >= 3 ? splatGeometry.getAttribute( 'sphericalHarmonics3' ).array : undefined
			} );
		const localCameraPosition = uniform( new Vector3() );
		const sphericalHarmonicsComputeNode = createSphericalHarmonicsComputeNode( buffers, localCameraPosition );
		const sort = new CountingSort( count, { binCount: BIN_COUNT, workgroupSize: WORKGROUP_SIZE } );
		const materialNodes = createMaterialNodes( buffers, sort, localCameraPosition, capacity !== null );
		const material = createMaterial( materialNodes.vertexNode, materialNodes.fragmentNode );

		super( geometry, material );

		this.isGaussianSplatMesh = true;

		this.type = 'GaussianSplatMesh';

		this.splatGeometry = splatGeometry;

		this.autoSort = autoSort;

		this.frustumCulled = false;

		// [capacity] + [uploadPage] fork state.
		this.capacity = capacity;
		this.partialUploadBroken = false;
		this._gpuPrimed = false;
		this._pendingRangeAttributes = [];
		this._sh1Bytes = null; // derived lazily — setupPBO may REPLACE the array (WebGL)

		this._buffers = buffers;
		this._sort = sort;
		this._sortMatrix = uniform( new Matrix4() );
		this._sortDepthRange = uniform( new Vector2( 0, 1 ) );
		this._sortInitialized = false;
		this._lastSortPosition = new Vector3( Infinity, Infinity, Infinity );
		this._lastSortDirection = new Vector3( 0, 0, - 1 );
		this._localCameraPosition = localCameraPosition;
		this._sphericalHarmonicsComputeNode = sphericalHarmonicsComputeNode;
		this._sphericalHarmonicsInitialized = false;
		this._lastSphericalHarmonicsCameraMatrix = new Matrix4();
		this._lastSphericalHarmonicsWorldMatrix = new Matrix4();
		this._sphericalHarmonicsVertexNode = materialNodes.sphericalHarmonicsVertexNode;
		this._precomputedSphericalHarmonicsVertexNode = materialNodes.vertexNode;
		this._positionAttribute = capacity !== null ? null : positionAttribute;

		const centerRead = buffers.centerRead;
		const sortMatrix = this._sortMatrix;
		const sortDepthRange = this._sortDepthRange;

		sort.setBinNode( () => {

			const center = centerRead.element( instanceIndex ).xyz.toVar( 'center' );
			const viewCenter = sortMatrix.mul( vec4( center, 1 ) ).xyz.toVar( 'viewCenter' );
			const depth = viewCenter.z.negate().toVar( 'depth' );
			const range = max( sortDepthRange.y.sub( sortDepthRange.x ), 0.0001 ).toVar( 'range' );
			const normalized = depth.sub( sortDepthRange.x ).div( range ).clamp( 0, 1 ).toVar( 'normalized' );
			const depthBin = uint( normalized.mul( BIN_COUNT - 1 ) ).toVar( 'depthBin' );

			return uint( BIN_COUNT - 1 ).sub( depthBin );

		} );

		this.onBeforeRender = ( renderer, scene, camera ) => {

			const vertexNode = renderer.backend && renderer.backend.isWebGLBackend === true ?
				this._sphericalHarmonicsVertexNode :
				this._precomputedSphericalHarmonicsVertexNode;

			if ( vertexNode !== null && material.vertexNode !== vertexNode ) {

				material.vertexNode = vertexNode;
				material.needsUpdate = true;

			}

			this.updateSphericalHarmonics( renderer, camera );

			if ( this.autoSort === true ) {

				this.updateSort( renderer, camera );

			}

		};

	}

	/**
	 * [uploadPage] Writes one decoded page into the storage buffers via the
	 * partial-update path. `page` = { count, center f32·n·3, covariance f32·n·6,
	 * color u8·n·4, sh1 f32·n·9 (length 0 when absent) }. The page tail past
	 * `count` is zeroed (center.w = 0 ⇒ degenerate), so a short last chunk can
	 * safely replace a full evicted one. Selection is NOT set here — the caller
	 * runs the traversal and calls setSelection() next.
	 */
	uploadPage( slot, page ) {

		const base = slot * PAGE_SIZE;
		if ( base + PAGE_SIZE > this._buffers.count ) throw new Error( `uploadPage: slot ${ slot } exceeds capacity` );

		const { count, center, covariance, color, sh1 } = page;
		const buffers = this._buffers;
		const centerData = buffers.centerAttribute.array;
		const covAData = buffers.covarianceAAttribute.array;
		const covBData = buffers.covarianceBAttribute.array;
		const colorData = buffers.colorAttribute.array;

		for ( let i = 0; i < count; i ++ ) {

			const i3 = i * 3;
			const i4 = ( base + i ) * 4;
			const i6 = i * 6;

			centerData[ i4 ] = center[ i3 ];
			centerData[ i4 + 1 ] = center[ i3 + 1 ];
			centerData[ i4 + 2 ] = center[ i3 + 2 ];
			centerData[ i4 + 3 ] = 0;

			covAData[ i4 ] = covariance[ i6 ];
			covAData[ i4 + 1 ] = covariance[ i6 + 1 ];
			covAData[ i4 + 2 ] = covariance[ i6 + 2 ];
			covAData[ i4 + 3 ] = covariance[ i6 + 3 ];

			covBData[ i4 ] = covariance[ i6 + 4 ];
			covBData[ i4 + 1 ] = covariance[ i6 + 5 ];
			covBData[ i4 + 2 ] = 0;
			covBData[ i4 + 3 ] = 0;

			colorData[ i4 ] = color[ i * 4 ] / 255;
			colorData[ i4 + 1 ] = color[ i * 4 + 1 ] / 255;
			colorData[ i4 + 2 ] = color[ i * 4 + 2 ] / 255;
			colorData[ i4 + 3 ] = color[ i * 4 + 3 ] / 255;

		}

		centerData.fill( 0, ( base + count ) * 4, ( base + PAGE_SIZE ) * 4 );
		covAData.fill( 0, ( base + count ) * 4, ( base + PAGE_SIZE ) * 4 );
		covBData.fill( 0, ( base + count ) * 4, ( base + PAGE_SIZE ) * 4 );
		colorData.fill( 0, ( base + count ) * 4, ( base + PAGE_SIZE ) * 4 );

		this._pushPageRange( buffers.centerAttribute, base * 4, PAGE_SIZE * 4 );
		this._pushPageRange( buffers.covarianceAAttribute, base * 4, PAGE_SIZE * 4 );
		this._pushPageRange( buffers.covarianceBAttribute, base * 4, PAGE_SIZE * 4 );
		this._pushPageRange( buffers.colorAttribute, base * 4, PAGE_SIZE * 4 );

		const sh1Attribute = this._buffers.sphericalHarmonics1Attribute;
		if ( sh1Attribute !== undefined ) {

			// Re-derive the byte view if the backing array changed: on WebGL,
			// setupPBO replaces attribute.array with a (possibly padded) copy
			// (three.webgpu.js:64678) — a cached view would write to a dead buffer.
			if ( this._sh1Bytes === null || this._sh1Bytes.buffer !== sh1Attribute.array.buffer ) {

				this._sh1Bytes = new Uint8ClampedArray( sh1Attribute.array.buffer );

			}

			// Pack coefficient-major RGB triplets (GsplatSH1 layout) into the addon's
			// clamped-byte words: byte = v·128 + 128, saturating at ±1 — the accepted
			// 8-bit SH quantization (doc 03 §H.3; hero sh1 max 1.505 saturates ~12%).
			const bytes = this._sh1Bytes;
			const wordBytes = SH_BAND_WORDS[ 1 ] * 4; // 12 bytes per splat
			for ( let i = 0; i < PAGE_SIZE; i ++ ) {

				const target = ( base + i ) * wordBytes;
				if ( i < count && sh1.length > 0 ) {

					for ( let j = 0; j < 9; j ++ ) bytes[ target + j ] = sh1[ i * 9 + j ] * 128 + 128;
					bytes[ target + 9 ] = 128; bytes[ target + 10 ] = 128; bytes[ target + 11 ] = 128;

				} else {

					bytes.fill( 128, target, target + wordBytes );

				}

			}

			this._pushPageRange( this._buffers.sphericalHarmonics1Attribute, base * SH_BAND_WORDS[ 1 ], PAGE_SIZE * SH_BAND_WORDS[ 1 ] );

		}

	}

	/**
	 * [selection] Rewrites the center.w selection lane for one page.
	 * `flags` is a Uint8Array of PAGE_SIZE entries (1 = render, 0 = degenerate).
	 */
	setSelection( slot, flags ) {

		const base = slot * PAGE_SIZE;
		const centerData = this._buffers.centerAttribute.array;
		for ( let i = 0; i < PAGE_SIZE; i ++ ) {

			centerData[ ( base + i ) * 4 + 3 ] = flags[ i ];

		}

		this._pushPageRange( this._buffers.centerAttribute, base * 4, PAGE_SIZE * 4 );

	}

	/**
	 * [invalidate] Explicit sort + SH invalidation after uploads/selection
	 * changes. Nothing updates by itself: a page arriving under a motionless
	 * camera must still be sorted into draw order and receive SH contribution.
	 */
	invalidate() {

		this._sortInitialized = false;
		this._sphericalHarmonicsInitialized = false;

	}

	/**
	 * [uploadPage] Call after the next render/compute. If any pushed range
	 * survived (backend did not consume it), the partial path is not being hit:
	 * fall back to full-buffer uploads and record it.
	 *
	 * First call after the first render only primes: buffer CREATION copies the
	 * full array (three.webgpu.js:81093, mappedAtCreation) and never clears
	 * updateRanges, so pre-first-render ranges legitimately survive. The
	 * assertion is meaningful only for uploads against an existing GPU buffer.
	 */
	assertPartialUploadConsumed() {

		if ( this._gpuPrimed !== true ) {

			this._gpuPrimed = true;
			for ( const attribute of this._pendingRangeAttributes ) attribute.clearUpdateRanges();
			this._pendingRangeAttributes.length = 0;
			return true;

		}

		let broken = false;
		for ( const attribute of this._pendingRangeAttributes ) {

			if ( attribute.updateRanges.length > 0 ) {

				broken = true;
				attribute.clearUpdateRanges();
				attribute.needsUpdate = true;

			}

		}

		this._pendingRangeAttributes.length = 0;
		if ( broken ) this.partialUploadBroken = true;
		return ! broken;

	}

	_pushPageRange( attribute, start, count ) {

		// WebGL backend: the vertex shader reads storage through a PBO
		// DataTexture that shares the attribute's array but re-uploads only on
		// its OWN needsUpdate (three.webgpu.js:64682; same pattern as
		// CountingSort.computeCPU). Whole-texture upload — no partial path on
		// the fallback; the cost is a recorded fallback characteristic.
		if ( attribute.pbo !== undefined ) attribute.pbo.needsUpdate = true;

		if ( this.partialUploadBroken === true ) {

			// Fallback: full-buffer upload (cost recorded by measure.ts).
			attribute.needsUpdate = true;
			return;

		}

		attribute.addUpdateRange( start, count );
		attribute.needsUpdate = true;
		if ( this._pendingRangeAttributes.indexOf( attribute ) === - 1 ) this._pendingRangeAttributes.push( attribute );

		// Watchdog: a working partial path leaves ranges near zero between
		// renders (each upload adds ≤6, each render clears). Thousands of
		// accumulated ranges mean the backend never consumes them — the
		// race-free signal that the partial path is broken. (The race-PRONE
		// signal — asserting right after a render — false-positives whenever an
		// async decode lands between render and assert; use
		// assertPartialUploadConsumed() only in controlled probe sequences.)
		if ( attribute.updateRanges.length > 10000 ) {

			this.partialUploadBroken = true;
			attribute.clearUpdateRanges();
			attribute.needsUpdate = true;

		}

	}

	updateSphericalHarmonics( renderer, camera ) {

		if ( this._sphericalHarmonicsComputeNode === null ) return false;

		const isWebGLBackend = renderer.backend && renderer.backend.isWebGLBackend === true;

		if ( this._sphericalHarmonicsInitialized === true &&
			camera.matrixWorld.equals( this._lastSphericalHarmonicsCameraMatrix ) &&
			this.matrixWorld.equals( this._lastSphericalHarmonicsWorldMatrix ) &&
			( isWebGLBackend === true || this._buffers.sphericalHarmonicsContributionRead !== undefined ) ) {

			return false;

		}

		if ( isWebGLBackend === true ) {

			enableWebGLBuffers( this._buffers );

		}

		_worldMatrixInverse.copy( this.matrixWorld ).invert();
		this._localCameraPosition.value.setFromMatrixPosition( camera.matrixWorld ).applyMatrix4( _worldMatrixInverse );

		this._lastSphericalHarmonicsCameraMatrix.copy( camera.matrixWorld );
		this._lastSphericalHarmonicsWorldMatrix.copy( this.matrixWorld );
		this._sphericalHarmonicsInitialized = true;

		if ( isWebGLBackend === true ) return false;

		ensureSphericalHarmonicsContributionBuffer( this._buffers );
		renderer.compute( this._sphericalHarmonicsComputeNode );

		return true;

	}

	updateSort( renderer, camera ) {

		if ( this._sortInitialized === false || this._needsSort( camera ) === true ) {

			this._updateSortUniforms( camera );

			if ( renderer.backend && renderer.backend.isWebGLBackend === true ) {

				enableWebGLBuffers( this._buffers );
				this._sort.enableWebGLBuffers();
				this._sortCPU();

			} else {

				this._sort.compute( renderer );

			}

			this._sortInitialized = true;

			return true;

		}

		return false;

	}

	_needsSort( camera ) {

		_cameraPosition.setFromMatrixPosition( camera.matrixWorld );

		const e = camera.matrixWorld.elements;
		_cameraDirection.set( - e[ 8 ], - e[ 9 ], - e[ 10 ] ).normalize();

		const positionChanged = _cameraPosition.distanceToSquared( this._lastSortPosition ) > SORT_POSITION_THRESHOLD * SORT_POSITION_THRESHOLD;
		const directionChanged = _cameraDirection.dot( this._lastSortDirection ) < SORT_DIRECTION_THRESHOLD;

		if ( positionChanged === true || directionChanged === true ) {

			this._lastSortPosition.copy( _cameraPosition );
			this._lastSortDirection.copy( _cameraDirection );
			return true;

		}

		return false;

	}

	_updateSortUniforms( camera ) {

		this.updateWorldMatrix( true, false );

		this._sortMatrix.value.multiplyMatrices( camera.matrixWorldInverse, this.matrixWorld );

		_worldCenter.copy( this.splatGeometry.boundingSphere.center ).applyMatrix4( this.matrixWorld );
		_viewCenter.copy( _worldCenter ).applyMatrix4( camera.matrixWorldInverse );
		this.getWorldScale( _worldScale );

		const radius = this.splatGeometry.boundingSphere.radius * Math.max( _worldScale.x, _worldScale.y, _worldScale.z );
		const depth = - _viewCenter.z;
		const nearDepth = Math.max( camera.near, depth - radius );
		const farDepth = Math.max( nearDepth + 0.0001, depth + radius );

		_sortDepthRange.set( nearDepth, farDepth );
		this._sortDepthRange.value.copy( _sortDepthRange );

	}

	_sortCPU() {

		const matrix = this._sortMatrix.value.elements;
		const nearDepth = this._sortDepthRange.value.x;
		const range = Math.max( this._sortDepthRange.value.y - nearDepth, 0.0001 );
		const scale = ( BIN_COUNT - 1 ) / range;

		if ( this._positionAttribute !== null ) {

			const centers = this._positionAttribute.array;

			this._sort.computeCPU( ( i ) => {

				const i3 = i * 3;
				const depth = - ( matrix[ 2 ] * centers[ i3 ] + matrix[ 6 ] * centers[ i3 + 1 ] + matrix[ 10 ] * centers[ i3 + 2 ] + matrix[ 14 ] );
				const depthBin = Math.min( BIN_COUNT - 1, Math.max( 0, Math.floor( ( depth - nearDepth ) * scale ) ) );

				return BIN_COUNT - 1 - depthBin;

			} );

		} else {

			// [capacity] no source position attribute — read the vec4 center storage array.
			const centers = this._buffers.centerAttribute.array;

			this._sort.computeCPU( ( i ) => {

				const i4 = i * 4;
				const depth = - ( matrix[ 2 ] * centers[ i4 ] + matrix[ 6 ] * centers[ i4 + 1 ] + matrix[ 10 ] * centers[ i4 + 2 ] + matrix[ 14 ] );
				const depthBin = Math.min( BIN_COUNT - 1, Math.max( 0, Math.floor( ( depth - nearDepth ) * scale ) ) );

				return BIN_COUNT - 1 - depthBin;

			} );

		}

	}

}

function createGeometry( count ) {

	const geometry = new InstancedBufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [
		- 2, - 2, 0,
		2, - 2, 0,
		2, 2, 0,
		- 2, 2, 0
	] ), 3 ) );
	geometry.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	geometry.instanceCount = count;

	return geometry;

}

// [capacity] like createStorageBuffers, but from empty arrays at a fixed
// capacity: centers zeroed (w = 0 ⇒ everything starts deselected), SH words
// neutral 0x80808080. Also exposes the four attributes for uploadPage.
function createEmptyStorageBuffers( count, sphericalHarmonicsDegree ) {

	const centerAttribute = new StorageBufferAttribute( new Float32Array( count * 4 ), 4 );
	const covarianceAAttribute = new StorageBufferAttribute( new Float32Array( count * 4 ), 4 );
	const covarianceBAttribute = new StorageBufferAttribute( new Float32Array( count * 4 ), 4 );
	const colorAttribute = new StorageBufferAttribute( new Float32Array( count * 4 ), 4 );

	const buffers = {
		count,
		sphericalHarmonicsDegree,
		webGLBuffersEnabled: false,
		centerAttribute,
		covarianceAAttribute,
		covarianceBAttribute,
		colorAttribute,
		centerRead: storage( centerAttribute, 'vec4', count ).toReadOnly(),
		covarianceARead: storage( covarianceAAttribute, 'vec4', count ).toReadOnly(),
		covarianceBRead: storage( covarianceBAttribute, 'vec4', count ).toReadOnly(),
		colorRead: storage( colorAttribute, 'vec4', count ).toReadOnly()
	};

	for ( let degree = 1; degree <= sphericalHarmonicsDegree; degree ++ ) {

		const words = SH_BAND_WORDS[ degree ];
		const attribute = new StorageBufferAttribute( createPackedSphericalHarmonicsBand( count, degree ).packed, 1 );

		buffers[ `sphericalHarmonics${ degree }Attribute` ] = attribute;
		buffers[ `sphericalHarmonics${ degree }Read` ] = storage( attribute, 'uint', count * words ).toReadOnly();
		buffers[ `sphericalHarmonics${ degree }Words` ] = words;

	}

	return buffers;

}

function createStorageBuffers( count, centers, covariances, colors, sphericalHarmonics ) {

	const centerData = new Float32Array( count * 4 );
	const covarianceAData = new Float32Array( count * 4 );
	const covarianceBData = new Float32Array( count * 4 );
	const colorData = new Float32Array( count * 4 );
	const sphericalHarmonicsDegree = sphericalHarmonics.degree;

	for ( let i = 0; i < count; i ++ ) {

		const i3 = i * 3;
		const i4 = i * 4;
		const i6 = i * 6;

		centerData[ i4 ] = centers[ i3 ];
		centerData[ i4 + 1 ] = centers[ i3 + 1 ];
		centerData[ i4 + 2 ] = centers[ i3 + 2 ];
		// w stays 0 as upstream leaves it — the selection cull is compiled out on
		// this path (useSelection false), and the buffer must stay byte-identical
		// to the vendor's (H-FORK).

		covarianceAData[ i4 ] = covariances[ i6 ];
		covarianceAData[ i4 + 1 ] = covariances[ i6 + 1 ];
		covarianceAData[ i4 + 2 ] = covariances[ i6 + 2 ];
		covarianceAData[ i4 + 3 ] = covariances[ i6 + 3 ];

		covarianceBData[ i4 ] = covariances[ i6 + 4 ];
		covarianceBData[ i4 + 1 ] = covariances[ i6 + 5 ];

		colorData[ i4 ] = colors[ i4 ] / 255;
		colorData[ i4 + 1 ] = colors[ i4 + 1 ] / 255;
		colorData[ i4 + 2 ] = colors[ i4 + 2 ] / 255;
		colorData[ i4 + 3 ] = colors[ i4 + 3 ] / 255;

	}

	const centerAttribute = new StorageBufferAttribute( centerData, 4 );
	const covarianceAAttribute = new StorageBufferAttribute( covarianceAData, 4 );
	const covarianceBAttribute = new StorageBufferAttribute( covarianceBData, 4 );
	const colorAttribute = new StorageBufferAttribute( colorData, 4 );

	const buffers = {
		count,
		sphericalHarmonicsDegree,
		webGLBuffersEnabled: false,
		centerAttribute,
		covarianceAAttribute,
		covarianceBAttribute,
		colorAttribute,
		centerRead: storage( centerAttribute, 'vec4', count ).toReadOnly(),
		covarianceARead: storage( covarianceAAttribute, 'vec4', count ).toReadOnly(),
		covarianceBRead: storage( covarianceBAttribute, 'vec4', count ).toReadOnly(),
		colorRead: storage( colorAttribute, 'vec4', count ).toReadOnly()
	};

	for ( let degree = 1; degree <= sphericalHarmonicsDegree; degree ++ ) {

		const words = SH_BAND_WORDS[ degree ];
		const attribute = new StorageBufferAttribute( sphericalHarmonics[ `sh${ degree }` ], 1 );

		buffers[ `sphericalHarmonics${ degree }Attribute` ] = attribute;
		buffers[ `sphericalHarmonics${ degree }Read` ] = storage( attribute, 'uint', count * words ).toReadOnly();
		buffers[ `sphericalHarmonics${ degree }Words` ] = words;

	}

	return buffers;

}

function ensureSphericalHarmonicsContributionBuffer( buffers ) {

	if ( buffers.sphericalHarmonicsContributionRead !== undefined ) return;

	const attribute = new StorageBufferAttribute( new Float32Array( buffers.count * 4 ), 4 );

	buffers.sphericalHarmonicsContributionRead = storage( attribute, 'vec4', buffers.count ).toReadOnly();
	buffers.sphericalHarmonicsContributionWrite = storage( attribute, 'vec4', buffers.count );

}

function enableWebGLBuffers( buffers ) {

	if ( buffers.webGLBuffersEnabled === true ) return;

	buffers.centerRead.setPBO( true );
	buffers.covarianceARead.setPBO( true );
	buffers.covarianceBRead.setPBO( true );
	buffers.colorRead.setPBO( true );

	for ( let degree = 1; degree <= buffers.sphericalHarmonicsDegree; degree ++ ) {

		buffers[ `sphericalHarmonics${ degree }Read` ].setPBO( true );

	}

	buffers.webGLBuffersEnabled = true;

}

function unpackSphericalHarmonicsCoefficients( buffer, splatIndex, words, componentCount ) {

	const coefficients = [];
	let remaining = componentCount;

	for ( let word = 0; word < words && remaining > 0; word ++ ) {

		const packed = buffer.element( splatIndex.mul( words ).add( word ) ).toVar();
		const bytesInWord = Math.min( 4, remaining );

		for ( let byteIndex = 0; byteIndex < bytesInWord; byteIndex ++ ) {

			const byte = packed.shiftRight( byteIndex * 8 ).bitAnd( 0xff );
			coefficients.push( float( byte ).sub( 128 ).div( 128 ) );

		}

		remaining -= bytesInWord;

	}

	return coefficients;

}

function assembleSphericalHarmonicsVectors( coefficients, name ) {

	const vectors = [];
	const vectorCount = coefficients.length / 3;

	for ( let i = 0; i < vectorCount; i ++ ) {

		const offset = i * 3;
		vectors.push( vec3(
			coefficients[ offset ],
			coefficients[ offset + 1 ],
			coefficients[ offset + 2 ]
		).toVar( `${ name }${ i }` ) );

	}

	return vectors;

}

function accumulateSphericalHarmonics( vectors, weights ) {

	let result = vectors[ 0 ].mul( weights[ 0 ] );

	for ( let i = 1; i < vectors.length; i ++ ) {

		result = result.add( vectors[ i ].mul( weights[ i ] ) );

	}

	return result;

}

function applySphericalHarmonicsBand( buffer, splatIndex, words, componentCount, name, weights ) {

	const coefficients = unpackSphericalHarmonicsCoefficients( buffer, splatIndex, words, componentCount );
	const vectors = assembleSphericalHarmonicsVectors( coefficients, name );

	return accumulateSphericalHarmonics( vectors, weights );

}

function applySphericalHarmonics( rgb, center, localCameraPosition, splatIndex, buffers ) {

	const viewDirection = normalize( center.sub( localCameraPosition ) ).toVar( 'sphericalHarmonicsViewDirection' );
	const x = viewDirection.x;
	const y = viewDirection.y;
	const z = viewDirection.z;

	rgb.addAssign( applySphericalHarmonicsBand(
		buffers.sphericalHarmonics1Read,
		splatIndex,
		buffers.sphericalHarmonics1Words,
		SH_BAND_COMPONENTS[ 1 ],
		'sh1_',
		[
			y.mul( - 0.4886025 ),
			z.mul( 0.4886025 ),
			x.mul( - 0.4886025 )
		]
	) );

	if ( buffers.sphericalHarmonicsDegree >= 2 ) {

		const xx = x.mul( x ).toVar( 'shXX' );
		const yy = y.mul( y ).toVar( 'shYY' );
		const zz = z.mul( z ).toVar( 'shZZ' );

		rgb.addAssign( applySphericalHarmonicsBand(
			buffers.sphericalHarmonics2Read,
			splatIndex,
			buffers.sphericalHarmonics2Words,
			SH_BAND_COMPONENTS[ 2 ],
			'sh2_',
			[
				x.mul( y ).mul( 1.0925484 ),
				y.mul( z ).mul( - 1.0925484 ),
				zz.mul( 2 ).sub( xx ).sub( yy ).mul( 0.3153915 ),
				x.mul( z ).mul( - 1.0925484 ),
				xx.sub( yy ).mul( 0.5462742 )
			]
		) );

		if ( buffers.sphericalHarmonicsDegree >= 3 ) {

			const xy = x.mul( y ).toVar( 'shXY' );

			rgb.addAssign( applySphericalHarmonicsBand(
				buffers.sphericalHarmonics3Read,
				splatIndex,
				buffers.sphericalHarmonics3Words,
				SH_BAND_COMPONENTS[ 3 ],
				'sh3_',
				[
					y.mul( xx.mul( 3 ).sub( yy ) ).mul( - 0.5900436 ),
					xy.mul( z ).mul( 2.8906114 ),
					y.mul( zz.mul( 4 ).sub( xx ).sub( yy ) ).mul( - 0.4570458 ),
					z.mul( zz.mul( 2 ).sub( xx.mul( 3 ) ).sub( yy.mul( 3 ) ) ).mul( 0.3731763 ),
					x.mul( zz.mul( 4 ).sub( xx ).sub( yy ) ).mul( - 0.4570458 ),
					z.mul( xx.sub( yy ) ).mul( 1.4453057 ),
					x.mul( xx.sub( yy.mul( 3 ) ) ).mul( - 0.5900436 )
				]
			) );

		}

	}

}

function createSphericalHarmonicsComputeNode( buffers, localCameraPosition ) {

	if ( buffers.sphericalHarmonicsDegree === 0 ) return null;

	return Fn( () => {

		const splatIndex = instanceIndex;
		const center = buffers.centerRead.element( splatIndex ).xyz.toVar( 'center' );
		const rgb = vec3( 0 ).toVar( 'sphericalHarmonicsContribution' );

		applySphericalHarmonics( rgb, center, localCameraPosition, splatIndex, buffers );
		buffers.sphericalHarmonicsContributionWrite.element( splatIndex ).assign( vec4( rgb, 0 ) );

	} )().compute( buffers.count, [ WORKGROUP_SIZE ] ).setName( 'GaussianSplatSphericalHarmonics' );

}

function createMaterialNodes( buffers, sort, localCameraPosition, useSelection ) {

	const splatUv = varyingProperty( 'vec2', 'vSplatUv' );
	const splatColor = varyingProperty( 'vec4', 'vSplatColor' );

	const createVertexNode = ( usePrecomputedSphericalHarmonics ) => Fn( () => {

		const splatIndex = sort.orderRead.element( instanceIndex ).toVar( 'splatIndex' );
		// [selection] read the full vec4: w carries the pager's selection flag.
		const centerFull = buffers.centerRead.element( splatIndex ).toVar( 'centerFull' );
		const center = centerFull.xyz.toVar( 'center' );
		const covA = buffers.covarianceARead.element( splatIndex ).toVar( 'covA' );
		const covB = buffers.covarianceBRead.element( splatIndex ).toVar( 'covB' );
		const color = buffers.colorRead.element( splatIndex ).toVar( 'splatColor' );
		const rgb = color.rgb.toVar( 'splatRgb' );

		if ( buffers.sphericalHarmonicsDegree > 0 ) {

			if ( usePrecomputedSphericalHarmonics === true ) {

				rgb.addAssign( buffers.sphericalHarmonicsContributionRead.element( splatIndex ).rgb );

			} else {

				applySphericalHarmonics( rgb, center, localCameraPosition, splatIndex, buffers );

			}

		}

		splatUv.assign( positionGeometry.xy );

		const viewCenter4 = highpModelViewMatrix.mul( vec4( center, 1 ) ).toVar( 'viewCenter4' );
		const viewCenter = viewCenter4.xyz.toVar( 'viewCenter' );
		const centerClip = cameraProjectionMatrix.mul( viewCenter4 ).toVar( 'centerClip' );

		const m = highpModelViewMatrix;
		const r0 = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x ).toVar( 'r0' );
		const r1 = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y ).toVar( 'r1' );
		const r2 = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z ).toVar( 'r2' );

		const cov0 = vec3( covA.x, covA.y, covA.z ).toVar( 'cov0' );
		const cov1 = vec3( covA.y, covA.w, covB.x ).toVar( 'cov1' );
		const cov2 = vec3( covA.z, covB.x, covB.y ).toVar( 'cov2' );

		const vc0 = vec3( dot( r0, cov0 ), dot( r0, cov1 ), dot( r0, cov2 ) ).toVar( 'vc0' );
		const vc1 = vec3( dot( r1, cov0 ), dot( r1, cov1 ), dot( r1, cov2 ) ).toVar( 'vc1' );
		const vc2 = vec3( dot( r2, cov0 ), dot( r2, cov1 ), dot( r2, cov2 ) ).toVar( 'vc2' );

		const c00 = dot( vc0, r0 ).toVar( 'c00' );
		const c01 = dot( vc0, r1 ).toVar( 'c01' );
		const c02 = dot( vc0, r2 ).toVar( 'c02' );
		const c11 = dot( vc1, r1 ).toVar( 'c11' );
		const c12 = dot( vc1, r2 ).toVar( 'c12' );
		const c22 = dot( vc2, r2 ).toVar( 'c22' );

		const z = min( viewCenter.z, - 0.01 ).toVar( 'z' );
		const invZ = float( 1 ).div( z ).toVar( 'invZ' );
		const invZ2 = invZ.mul( invZ ).toVar( 'invZ2' );
		const focal = screenSize.mul( 0.5 ).mul( vec2( cameraProjectionMatrix[ 0 ].x, cameraProjectionMatrix[ 1 ].y ) ).toVar( 'focal' );

		const j00 = focal.x.negate().mul( invZ ).toVar( 'j00' );
		const j11 = focal.y.negate().mul( invZ ).toVar( 'j11' );
		const j02 = focal.x.mul( viewCenter.x ).mul( invZ2 ).toVar( 'j02' );
		const j12 = focal.y.mul( viewCenter.y ).mul( invZ2 ).toVar( 'j12' );

		const aBase = j00.mul( j00 ).mul( c00 )
			.add( j00.mul( j02 ).mul( c02 ).mul( 2 ) )
			.add( j02.mul( j02 ).mul( c22 ) )
			.toVar( 'cov2dABase' );
		const b = j00.mul( j11 ).mul( c01 )
			.add( j00.mul( j12 ).mul( c02 ) )
			.add( j02.mul( j11 ).mul( c12 ) )
			.add( j02.mul( j12 ).mul( c22 ) )
			.toVar( 'cov2dB' );
		const cBase = j11.mul( j11 ).mul( c11 )
			.add( j11.mul( j12 ).mul( c12 ).mul( 2 ) )
			.add( j12.mul( j12 ).mul( c22 ) )
			.toVar( 'cov2dCBase' );
		const a = aBase.add( KERNEL_2D_SIZE ).toVar( 'cov2dA' );
		const c = cBase.add( KERNEL_2D_SIZE ).toVar( 'cov2dC' );
		const detBase = aBase.mul( cBase ).sub( b.mul( b ) ).toVar( 'detBase' );
		const det = a.mul( c ).sub( b.mul( b ) ).toVar( 'det' );
		const alphaScale = sqrt( max( detBase.div( max( det, 0.000001 ) ), 0 ) ).toVar( 'alphaScale' );

		splatColor.assign( vec4( rgb.clamp( 0, 1 ), color.a.mul( alphaScale ) ) );

		const halfTrace = a.add( c ).mul( 0.5 ).toVar( 'halfTrace' );
		const radius = sqrt( max( a.sub( c ).mul( 0.5 ).pow2().add( b.mul( b ) ), 0.0000001 ) ).toVar( 'radius' );
		const lambda1 = max( halfTrace.add( radius ), 0.0000001 ).toVar( 'lambda1' );
		const lambda2 = max( halfTrace.sub( radius ), 0.0000001 ).toVar( 'lambda2' );
		const axis1 = vec2( 1, 0 ).toVar( 'axis1' );

		If( radius.greaterThan( 0.00001 ), () => {

			const angle = atan( b.mul( 2 ), a.sub( c ) ).mul( 0.5 ).toVar( 'angle' );
			axis1.assign( vec2( cos( angle ), sin( angle ) ) );

		} );

		const axis2 = vec2( axis1.y.negate(), axis1.x ).toVar( 'axis2' );

		const scale1 = min( sqrt( lambda1 ), MAX_SCREEN_SPACE_SPLAT_SIZE ).toVar( 'scale1' );
		const scale2 = min( sqrt( lambda2 ), MAX_SCREEN_SPACE_SPLAT_SIZE ).toVar( 'scale2' );
		const offsetPixels = axis1.mul( positionGeometry.x ).mul( scale1 ).add( axis2.mul( positionGeometry.y ).mul( scale2 ) ).toVar( 'offsetPixels' );
		const offsetNdc = offsetPixels.mul( 2 ).div( screenSize ).toVar( 'offsetNdc' );
		const clip = centerClip.add( vec4( offsetNdc.mul( centerClip.w ), 0, 0 ) ).toVar( 'clip' );

		const clipLimit = centerClip.w.mul( CLIP_XY ).toVar( 'clipLimit' );

		let cull = viewCenter.z.greaterThanEqual( - 0.01 )
			.or( centerClip.z.lessThan( centerClip.w.negate() ) )
			.or( centerClip.z.greaterThan( centerClip.w ) )
			.or( centerClip.x.lessThan( clipLimit.negate() ) )
			.or( centerClip.x.greaterThan( clipLimit ) )
			.or( centerClip.y.lessThan( clipLimit.negate() ) )
			.or( centerClip.y.greaterThan( clipLimit ) );

		if ( useSelection === true ) {

			// [selection] deselected splats (w < 0.5) collapse to a degenerate quad.
			cull = cull.or( centerFull.w.lessThan( 0.5 ) );

		}

		If( cull, () => {

			clip.assign( vec4( 2, 2, 2, 1 ) );

		} );

		return clip;

	} )();

	const vertexNode = createVertexNode( true );
	const sphericalHarmonicsVertexNode = buffers.sphericalHarmonicsDegree > 0 ? createVertexNode( false ) : null;

	const fragmentNode = Fn( () => {

		const r2 = dot( splatUv, splatUv ).toVar( 'r2' );

		If( r2.greaterThan( 4 ), () => {

			Discard();

		} );

		return vec4( splatColor.rgb, exp( r2.mul( - 0.5 ) ).mul( splatColor.a ) );

	} )();

	return { vertexNode, sphericalHarmonicsVertexNode, fragmentNode };

}

function createMaterial( vertexNode, fragmentNode ) {

	const material = new NodeMaterial();
	material.vertexNode = vertexNode;
	material.colorNode = fragmentNode;
	material.transparent = true;
	material.depthWrite = false;
	material.depthTest = true;
	material.forceSinglePass = true;
	material.fog = false;

	return material;

}

export { GaussianSplatMesh };
