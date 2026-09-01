/* memo_crypto.js — ECDH(secp256k1) + AES-256-GCM over the memo key.
 *
 * Scheme (identical to the one VIZ Hub already runs on its own two sides):
 *   shared_x = ECDH(my memo private key, their public key)   32 bytes, X only
 *   aes_key  = SHA-512(shared_x)[0:32]                       AES-256
 *   iv       = 12 random bytes
 *   ct       = AES-256-GCM(aes_key, iv, utf8(message)) ‖ tag(16)
 *
 * The private key never leaves the extension: the page hands over a public key and a
 * string, and gets back a string.
 *
 * Loaded as a classic script by the Chrome service worker (importScripts), by the
 * Firefox background page and by the tests. Requires secp256k1.js to be loaded first —
 * viz.min.js keeps its own curve code private, it only exposes the memo scheme.
 *
 * Errors are thrown as {code:'...', message:'...'} so the caller can map them onto the
 * error codes the page sees; every code here is one the page is allowed to learn.
 */
(function(root){
	const B58_ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

	function fail(code,message){
		let error=new Error(message||code);
		error.code=code;
		return error;
	}

	function base58_decode(str){
		let num=0n;
		for(let i=0;i<str.length;i++){
			let digit=B58_ALPHABET.indexOf(str[i]);
			if(digit<0){
				throw fail('bad_base58','not a base58 string');
			}
			num=num*58n+BigInt(digit);
		}
		let hex=num.toString(16);
		if(hex.length%2){
			hex='0'+hex;
		}
		let body=(num===0n)?[]:hex.match(/../g).map(function(pair){return parseInt(pair,16);});
		let leading=0;
		while(leading<str.length&&str[leading]==='1'){
			leading++;
		}
		let out=new Uint8Array(leading+body.length);
		out.set(body,leading);
		return out;
	}

	/* RIPEMD-160 — WebCrypto has no such digest, and the checksum of a VIZ public key is
	   built on it. ~80 lines, verified against node's crypto in tests/memo-crypto.mjs */
	function ripemd160(data){
		const rl=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
			3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12, 1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,
			4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
		const rr=[5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12, 6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
			15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13, 8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,
			12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
		const sl=[11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8, 7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
			11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5, 11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,
			9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
		const sr=[8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6, 9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
			9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5, 15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,
			8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
		const kl=[0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e];
		const kr=[0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0x00000000];
		function rol(x,n){return((x<<n)|(x>>>(32-n)))>>>0;}
		function f(j,x,y,z){
			if(j<16)return(x^y^z)>>>0;
			if(j<32)return((x&y)|(~x&z))>>>0;
			if(j<48)return((x|~y)^z)>>>0;
			if(j<64)return((x&z)|(y&~z))>>>0;
			return(x^(y|~z))>>>0;
		}
		let len=data.length;
		let padded=new Uint8Array((((len+8)>>6)+1)<<6);
		padded.set(data);
		padded[len]=0x80;
		let view=new DataView(padded.buffer);
		view.setUint32(padded.length-8,(len<<3)>>>0,true);
		view.setUint32(padded.length-4,Math.floor(len/536870912),true);
		let h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];
		for(let off=0;off<padded.length;off+=64){
			let w=[];
			for(let i=0;i<16;i++){
				w.push(view.getUint32(off+i*4,true));
			}
			let al=h[0],bl=h[1],cl=h[2],dl=h[3],el=h[4];
			let ar=h[0],br=h[1],cr=h[2],dr=h[3],er=h[4];
			for(let j=0;j<80;j++){
				let round=Math.floor(j/16);
				let t=(rol((al+f(j,bl,cl,dl)+w[rl[j]]+kl[round])>>>0,sl[j])+el)>>>0;
				al=el;el=dl;dl=rol(cl,10);cl=bl;bl=t;
				t=(rol((ar+f(79-j,br,cr,dr)+w[rr[j]]+kr[round])>>>0,sr[j])+er)>>>0;
				ar=er;er=dr;dr=rol(cr,10);cr=br;br=t;
			}
			let t=(h[1]+cl+dr)>>>0;
			h[1]=(h[2]+dl+er)>>>0;
			h[2]=(h[3]+el+ar)>>>0;
			h[3]=(h[4]+al+br)>>>0;
			h[4]=(h[0]+bl+cr)>>>0;
			h[0]=t;
		}
		let out=new Uint8Array(20);
		let out_view=new DataView(out.buffer);
		for(let i=0;i<5;i++){
			out_view.setUint32(i*4,h[i],true);
		}
		return out;
	}

	async function sha256(bytes){
		return new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
	}

	function bytes_equal(a,b){
		if(a.length!=b.length){
			return false;
		}
		let diff=0;
		for(let i=0;i<a.length;i++){
			diff|=a[i]^b[i];
		}
		return diff===0;
	}

	/* VIZ public key: prefix + base58(compressed_33 ‖ checksum_4).
	   Canonical VIZ (chain, viz-js-lib) checksums with RIPEMD-160; VIZ Hub tooling emits
	   the same body with a double-SHA-256 checksum, and its ephemeral keys for anonymous
	   letters come from there. Both are accepted — the checksum only guards against a
	   typo, and refusing one of the two shapes would break interop with keys that are
	   otherwise perfectly valid points. Anything else is bad_public_key. */
	async function parse_public_key(str,prefix){
		prefix=prefix||'VIZ';
		if(typeof str!=='string'||str.slice(0,prefix.length)!=prefix){
			throw fail('bad_public_key','public key must start with '+prefix);
		}
		let decoded;
		try{
			decoded=base58_decode(str.slice(prefix.length));
		}
		catch(e){
			throw fail('bad_public_key','public key is not base58');
		}
		if(decoded.length!=37){
			throw fail('bad_public_key','public key must decode to 37 bytes, got '+decoded.length);
		}
		let body=decoded.slice(0,33);
		let checksum=decoded.slice(33);
		let ripemd_ok=bytes_equal(checksum,ripemd160(body).slice(0,4));
		let sha_ok=false;
		if(!ripemd_ok){
			sha_ok=bytes_equal(checksum,(await sha256(await sha256(body))).slice(0,4));
		}
		if(!ripemd_ok&&!sha_ok){
			throw fail('bad_public_key','public key checksum does not match');
		}
		if(body[0]!=2&&body[0]!=3){
			throw fail('bad_public_key','public key is not a compressed point');
		}
		return body;
	}

	/* WIF: base58(0x80 ‖ private_32 ‖ sha256d(...)[0:4]) */
	async function private_key_from_wif(wif){
		if(typeof wif!=='string'||''==wif){
			throw fail('no_memo_key','memo key is empty');
		}
		let decoded;
		try{
			decoded=base58_decode(wif);
		}
		catch(e){
			throw fail('no_memo_key','memo key is not a valid WIF');
		}
		if(decoded.length!=37||decoded[0]!=0x80){
			throw fail('no_memo_key','memo key is not a valid WIF');
		}
		let body=decoded.slice(0,33);
		let checksum=decoded.slice(33);
		if(!bytes_equal(checksum,(await sha256(await sha256(body))).slice(0,4))){
			throw fail('no_memo_key','memo key checksum does not match');
		}
		return decoded.slice(1,33);
	}

	async function aes_key_from(private_key,public_key){
		let shared;
		try{
			/* compressed point, X is what both sides hash — no 0x04 prefix, no Y */
			shared=root.nobleSecp256k1.getSharedSecret(private_key,public_key,true).slice(1,33);
		}
		catch(e){
			throw fail('bad_public_key','public key is not a point on the curve');
		}
		let digest=new Uint8Array(await root.crypto.subtle.digest('SHA-512',shared));
		return await root.crypto.subtle.importKey('raw',digest.slice(0,32),{name:'AES-GCM'},false,['encrypt','decrypt']);
	}

	/* btoa/atob choke on megabyte strings when fed through fromCharCode.apply — chunk it */
	function base64_encode(bytes){
		let parts=[];
		for(let i=0;i<bytes.length;i+=0x8000){
			parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)));
		}
		return root.btoa(parts.join(''));
	}

	function base64_decode(str,code){
		if(typeof str!=='string'){
			throw fail(code||'bad_ciphertext','expected a base64 string');
		}
		let binary;
		try{
			binary=root.atob(str);
		}
		catch(e){
			throw fail(code||'bad_ciphertext','not a base64 string');
		}
		let out=new Uint8Array(binary.length);
		for(let i=0;i<binary.length;i++){
			out[i]=binary.charCodeAt(i);
		}
		return out;
	}

	async function encrypt(memo_wif,their_public_key,message){
		if(typeof message!=='string'){
			throw fail('bad_ciphertext','message must be a string');
		}
		let private_key=await private_key_from_wif(memo_wif);
		let public_key=await parse_public_key(their_public_key);
		let key=await aes_key_from(private_key,public_key);
		let iv=root.crypto.getRandomValues(new Uint8Array(12));
		let ct=new Uint8Array(await root.crypto.subtle.encrypt({name:'AES-GCM',iv:iv,tagLength:128},key,new TextEncoder().encode(message)));
		return {ct:base64_encode(ct),iv:base64_encode(iv)};
	}

	async function decrypt(memo_wif,their_public_key,ct_base64,iv_base64){
		let private_key=await private_key_from_wif(memo_wif);
		let public_key=await parse_public_key(their_public_key);
		let ct=base64_decode(ct_base64);
		let iv=base64_decode(iv_base64);
		if(iv.length!=12){
			throw fail('bad_ciphertext','iv must be 12 bytes, got '+iv.length);
		}
		if(ct.length<17){
			throw fail('bad_ciphertext','ciphertext is shorter than the auth tag');
		}
		let key=await aes_key_from(private_key,public_key);
		let plain;
		try{
			plain=await root.crypto.subtle.decrypt({name:'AES-GCM',iv:iv,tagLength:128},key,ct);
		}
		catch(e){
			/* the tag did not match: wrong key pair, or the bytes were tampered with.
			   Distinct from bad_ciphertext on purpose — the page shows a different hint */
			throw fail('auth_failed','authentication tag does not match');
		}
		return new TextDecoder().decode(plain);
	}

	root.VizMemoCrypto={
		encrypt:encrypt,
		decrypt:decrypt,
		parse_public_key:parse_public_key,
		private_key_from_wif:private_key_from_wif,
		base58_decode:base58_decode,
		base64_encode:base64_encode,
		base64_decode:base64_decode,
		ripemd160:ripemd160,
	};
})(typeof globalThis!=='undefined'?globalThis:self);
