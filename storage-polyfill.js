/* MV3: localStorage polyfill backed by chrome.storage.local.
   Extension pages (popup, options, action, operation) share storage
   with the service worker via chrome.storage.local. */
var _lsCache={};
var localStorage=new Proxy(_lsCache,{
	get:function(target,prop){
		if(prop==='getItem')return function(k){return target.hasOwnProperty(k)?target[k]:undefined;};
		if(prop==='setItem')return function(k,v){target[k]=String(v);chrome.storage.local.set({[k]:String(v)});};
		if(prop==='removeItem')return function(k){delete target[k];chrome.storage.local.remove(k);};
		return target[prop];
	},
	set:function(target,prop,value){
		target[prop]=String(value);
		chrome.storage.local.set({[prop]:String(value)});
		return true;
	},
	deleteProperty:function(target,prop){
		delete target[prop];
		chrome.storage.local.remove(prop);
		return true;
	}
});
chrome.storage.local.get(null,function(items){
	for(var k in items){_lsCache[k]=items[k];}
});
