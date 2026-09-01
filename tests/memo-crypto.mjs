/* Acceptance for the encrypt/decrypt crypto core (VIZ Hub spec, §2.1 / §6).
 * Verdict is the exit code: 0 = PASS, 1 = FAIL.
 *
 *   node tests/memo-crypto.mjs
 *
 * Node's own crypto is the oracle here: createECDH('secp256k1') + aes-256-gcm + ripemd160
 * are independent of everything the extension ships, so a match is real evidence and not
 * the same code agreeing with itself.
 */
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

require('../secp256k1.js');
require('../memo_crypto.js');
const C=globalThis.VizMemoCrypto;

let failures=0;
function check(name,ok,detail){
	if(ok){
		console.log('  ok   '+name);
	}
	else{
		failures++;
		console.log('  FAIL '+name+(detail?' — '+detail:''));
	}
}

const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes){
	let num=0n;
	for(const b of bytes){
		num=num*256n+BigInt(b);
	}
	let out='';
	while(num>0n){
		out=B58[Number(num%58n)]+out;
		num=num/58n;
	}
	for(const b of bytes){
		if(b===0){
			out='1'+out;
		}
		else break;
	}
	return out;
}
function viz_pubkey(compressed,mode){
	const checksum=(mode==='sha256d')
		?crypto.createHash('sha256').update(crypto.createHash('sha256').update(compressed).digest()).digest().slice(0,4)
		:crypto.createHash('ripemd160').update(compressed).digest().slice(0,4);
	return 'VIZ'+b58encode(Buffer.concat([compressed,checksum]));
}
function wif(priv){
	const body=Buffer.concat([Buffer.from([0x80]),priv]);
	const checksum=crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().slice(0,4);
	return b58encode(Buffer.concat([body,checksum]));
}
function pub_of(priv){
	return Buffer.from(globalThis.nobleSecp256k1.getPublicKey(new Uint8Array(priv),true));
}

/* the spec's own keys: private 0x11…11 and 0x22…22 */
const A_priv=Buffer.alloc(32,0x11);
const B_priv=Buffer.alloc(32,0x22);
const A_wif=wif(A_priv);
const B_wif=wif(B_priv);
const A_pub=pub_of(A_priv);
const B_pub=pub_of(B_priv);

console.log('1. spec test vector (§2.1)');
check('WIF of 0x11…11 matches the spec',A_wif==='5HwoXVkHoRM8sL2KmNRS217n1g8mPPBomrY7yehCuXC1115WWsh',A_wif);
check('WIF of 0x22…22 matches the spec',B_wif==='5J5KUK3VXP8HUefNVYPxwxVRokScZdWXpu1Tj8LfaAXMqHzMmbk',B_wif);
{
	/* the spec prints its public keys with a double-sha256 checksum; the chain and
	   viz-js-lib use ripemd160 over the same 33 body bytes — both must parse */
	const spec_A=viz_pubkey(A_pub,'sha256d');
	const spec_B=viz_pubkey(B_pub,'sha256d');
	check('spec public key A is reproduced byte for byte',spec_A==='VIZ7S7oY6Jrjzq8txrPmBwUhUmKzpN64835E7ura1HDDAVUvqRjJ1',spec_A);
	check('spec public key B is reproduced byte for byte',spec_B==='VIZ5RWLQudhUehv8bFcVwqJWBor8VTy4psRS2J2s9PwahRhw6fEVp',spec_B);

	const ec=crypto.createECDH('secp256k1');
	ec.setPrivateKey(A_priv);
	const shared=ec.computeSecret(B_pub);
	check('shared_x matches the spec',shared.toString('hex')==='77e0510d5042e2f5e9e59c977b81eeed590cf7d20c1c51da451a8eaa9fdc45ff',shared.toString('hex'));
	const aes_key=crypto.createHash('sha512').update(shared).digest().slice(0,32);
	check('aes_key matches the spec',aes_key.toString('hex')==='51b84da3f85e14a094ea5ecd813431a5fb8e3e7045d4f763575b7c6f9d3a1680');
}

const SPEC_CT='v0leirOST2gKOTJihY9D+oyikp/xzbF+fnnWzL4XBg==';
const SPEC_IV='AAAAAAAAAAAAAAAB';
const SPEC_TEXT='Hello, VIZ Hub!';

console.log('2. decrypt of the spec ciphertext, both directions');
for(const [name,key,other] of [['B decrypts with from=A',B_wif,viz_pubkey(A_pub,'sha256d')],
	['A decrypts with from=B',A_wif,viz_pubkey(B_pub,'sha256d')],
	['ripemd160-checksummed key parses too',B_wif,viz_pubkey(A_pub,'ripemd160')]]){
	try{
		const text=await C.decrypt(key,other,SPEC_CT,SPEC_IV);
		check(name,text===SPEC_TEXT,JSON.stringify(text));
	}
	catch(e){
		check(name,false,e.code+': '+e.message);
	}
}

console.log('3. our encrypt is readable by an independent implementation');
{
	const out=await C.encrypt(A_wif,viz_pubkey(B_pub,'ripemd160'),'проверка ↔ round-trip');
	const ec=crypto.createECDH('secp256k1');
	ec.setPrivateKey(B_priv);
	const aes_key=crypto.createHash('sha512').update(ec.computeSecret(A_pub)).digest().slice(0,32);
	const raw=Buffer.from(out.ct,'base64');
	const d=crypto.createDecipheriv('aes-256-gcm',aes_key,Buffer.from(out.iv,'base64'));
	d.setAuthTag(raw.slice(raw.length-16));
	const text=Buffer.concat([d.update(raw.slice(0,raw.length-16)),d.final()]).toString('utf8');
	check('node decrypts what the extension encrypted',text==='проверка ↔ round-trip',text);
	check('iv is 12 random bytes',Buffer.from(out.iv,'base64').length===12);
	const again=await C.encrypt(A_wif,viz_pubkey(B_pub,'ripemd160'),'проверка ↔ round-trip');
	check('iv is not reused between calls',again.iv!==out.iv);
}
{
	const iv=crypto.randomBytes(12);
	const ec=crypto.createECDH('secp256k1');
	ec.setPrivateKey(B_priv);
	const aes_key=crypto.createHash('sha512').update(ec.computeSecret(A_pub)).digest().slice(0,32);
	const c=crypto.createCipheriv('aes-256-gcm',aes_key,iv);
	const ct=Buffer.concat([c.update('letter from node','utf8'),c.final(),c.getAuthTag()]);
	const text=await C.decrypt(A_wif,viz_pubkey(B_pub,'ripemd160'),ct.toString('base64'),iv.toString('base64'));
	check('the extension decrypts what node encrypted',text==='letter from node',text);
}

console.log('4. one megabyte survives whole (§6.3)');
{
	let big='';
	while(big.length<1024*1024){
		big+='строка письма '+big.length+' — abcdefghijklmnopqrstuvwxyz\n';
	}
	const out=await C.encrypt(A_wif,viz_pubkey(B_pub,'ripemd160'),big);
	const back=await C.decrypt(B_wif,viz_pubkey(A_pub,'ripemd160'),out.ct,out.iv);
	check('1 MB round-trips character for character',back===big,'length '+back.length+' vs '+big.length);
}

console.log('5. ephemeral key with no account behind it (§6.5)');
{
	const eph_priv=crypto.randomBytes(32);
	const eph_pub=pub_of(eph_priv);
	const ec=crypto.createECDH('secp256k1');
	ec.setPrivateKey(eph_priv);
	const aes_key=crypto.createHash('sha512').update(ec.computeSecret(B_pub)).digest().slice(0,32);
	const iv=crypto.randomBytes(12);
	const c=crypto.createCipheriv('aes-256-gcm',aes_key,iv);
	const ct=Buffer.concat([c.update('anonymous letter','utf8'),c.final(),c.getAuthTag()]);
	const text=await C.decrypt(B_wif,viz_pubkey(eph_pub,'ripemd160'),ct.toString('base64'),iv.toString('base64'));
	check('anonymous letter decrypts',text==='anonymous letter',text);
}

console.log('6. error codes (§5)');
async function code_of(fn){
	try{
		await fn();
		return 'no error';
	}
	catch(e){
		return e.code||'no code';
	}
}
{
	const good_pub=viz_pubkey(B_pub,'ripemd160');
	check('garbage public key → bad_public_key',await code_of(()=>C.encrypt(A_wif,'VIZhello','x'))==='bad_public_key');
	const flipped='VIZ'+b58encode(Buffer.concat([B_pub,Buffer.from([0,0,0,0])]));
	check('broken checksum → bad_public_key',await code_of(()=>C.encrypt(A_wif,flipped,'x'))==='bad_public_key');
	check('public key of another curve shape → bad_public_key',
		await code_of(()=>C.encrypt(A_wif,viz_pubkey(Buffer.concat([Buffer.from([0x02]),Buffer.alloc(32,0xff)]),'ripemd160'),'x'))==='bad_public_key');
	check('empty memo key → no_memo_key',await code_of(()=>C.encrypt('',good_pub,'x'))==='no_memo_key');
	check('nonsense WIF → no_memo_key',await code_of(()=>C.encrypt('not-a-wif',good_pub,'x'))==='no_memo_key');
	check('ct is not base64 → bad_ciphertext',await code_of(()=>C.decrypt(B_wif,good_pub,'!!!!',SPEC_IV))==='bad_ciphertext');
	check('iv of the wrong length → bad_ciphertext',await code_of(()=>C.decrypt(B_wif,good_pub,SPEC_CT,'AAAA'))==='bad_ciphertext');
	check('ciphertext shorter than the tag → bad_ciphertext',await code_of(()=>C.decrypt(B_wif,good_pub,'AAAA',SPEC_IV))==='bad_ciphertext');
	/* letter addressed to somebody else: right shape, wrong key pair */
	const stranger=pub_of(crypto.randomBytes(32));
	check('letter for another key pair → auth_failed',await code_of(()=>C.decrypt(B_wif,viz_pubkey(stranger,'ripemd160'),SPEC_CT,SPEC_IV))==='auth_failed');
	/* one flipped byte inside a valid ciphertext must not read as bad_ciphertext */
	const tampered=Buffer.from(SPEC_CT,'base64');
	tampered[0]^=1;
	check('tampered ciphertext → auth_failed',
		await code_of(()=>C.decrypt(B_wif,viz_pubkey(A_pub,'sha256d'),tampered.toString('base64'),SPEC_IV))==='auth_failed');
}

console.log('7. building blocks against node');
{
	let ripemd_ok=true;
	for(let i=0;i<200;i++){
		const data=crypto.randomBytes(1+Math.floor(Math.random()*200));
		const mine=Buffer.from(C.ripemd160(new Uint8Array(data))).toString('hex');
		if(mine!==crypto.createHash('ripemd160').update(data).digest('hex')){
			ripemd_ok=false;
			break;
		}
	}
	check('ripemd160 matches node on 200 random inputs',ripemd_ok);
	let ecdh_ok=true;
	for(let i=0;i<50;i++){
		const priv=crypto.randomBytes(32);
		const peer=crypto.randomBytes(32);
		const ec=crypto.createECDH('secp256k1');
		ec.setPrivateKey(priv);
		const expected=ec.computeSecret(pub_of(peer)).toString('hex');
		const mine=Buffer.from(globalThis.nobleSecp256k1.getSharedSecret(new Uint8Array(priv),new Uint8Array(pub_of(peer)),true).slice(1,33)).toString('hex');
		if(mine!==expected){
			ecdh_ok=false;
			break;
		}
	}
	check('vendored ECDH matches node on 50 random pairs',ecdh_ok);
	let b64_ok=true;
	for(let i=0;i<50;i++){
		const data=crypto.randomBytes(Math.floor(Math.random()*100000));
		if(C.base64_encode(new Uint8Array(data))!==data.toString('base64')){
			b64_ok=false;
			break;
		}
	}
	check('base64 encoder matches node, including large buffers',b64_ok);
}

console.log(failures?('FAIL — '+failures+' check(s) failed'):'PASS — memo crypto core matches the spec');
process.exit(failures?1:0);
