(function(){
	'use strict';

	var enhancedModals=new WeakSet();
	var lastTrigger=null;
	var modalCounter=0;

	function textWithoutControls(node){
		if(!node){return '';}
		var clone=node.cloneNode(true);
		clone.querySelectorAll('input,select,textarea,button,svg,img').forEach(function(el){el.remove();});
		return (clone.textContent||'').replace(/^[\s—–:-]+|[\s—–:-]+$/g,'').replace(/\s+/g,' ').trim();
	}

	function accessibleName(el){
		if(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')){return true;}
		if(el.id&&document.querySelector('label[for="'+CSS.escape(el.id)+'"]')){return true;}
		if(el.closest('label')){return true;}
		return false;
	}

	function enhanceControls(root){
		root.querySelectorAll('a:not([href])').forEach(function(el){
			el.setAttribute('role','button');
			if(!el.hasAttribute('tabindex')){el.tabIndex=0;}
		});
		root.querySelectorAll('.origin-name, [class$="-action"], [class*="-action "]').forEach(function(el){
			if(/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)){return;}
			el.setAttribute('role','button');
			if(!el.hasAttribute('tabindex')){el.tabIndex=0;}
		});
		root.querySelectorAll('a,button').forEach(function(el){
			if(accessibleName(el)||(el.textContent||'').trim()){return;}
			var name=el.getAttribute('title')||el.getAttribute('data-title')||el.className||'';
			name=(''+name).replace(/[-_]+/g,' ').replace(/\b(unselectable|header icon|button|action)\b/g,' ').replace(/\s+/g,' ').trim();
			if(name){el.setAttribute('aria-label',name);}
		});
		root.querySelectorAll('[role="button"]').forEach(function(el){
			if(accessibleName(el)||(el.textContent||'').trim()){return;}
			var name=el.getAttribute('title')||el.className||'';
			name=(''+name).replace(/[-_]+/g,' ').replace(/\b(unselectable|icon|button|action)\b/g,' ').replace(/\s+/g,' ').trim();
			if(name){el.setAttribute('aria-label',name);}
		});
		root.querySelectorAll('.origin-name').forEach(function(el){
			el.setAttribute('aria-expanded',el.parentElement.classList.contains('closed')?'false':'true');
		});
		root.querySelectorAll('input,select,textarea').forEach(function(el){
			if(accessibleName(el)){return;}
			var name=el.getAttribute('placeholder')||textWithoutControls(el.parentElement)||el.getAttribute('name')||el.className||el.type;
			name=(''+name).replace(/[-_]+/g,' ').trim();
			if(name){el.setAttribute('aria-label',name);}
		});
		root.querySelectorAll('img').forEach(function(el){
			if(!el.hasAttribute('alt')){el.alt='';}
		});
		root.querySelectorAll('.error, .error-caption, .amount_error').forEach(function(el){
			el.setAttribute('role','alert');
			el.setAttribute('aria-live','assertive');
			el.setAttribute('aria-atomic','true');
		});
		root.querySelectorAll('.success-caption, .settings_status, .info').forEach(function(el){
			el.setAttribute('role','status');
			el.setAttribute('aria-live','polite');
			el.setAttribute('aria-atomic','true');
		});
	}

	function updateEnergy(slider){
		var selectedItems=slider.querySelectorAll('.energy_active.selected');
		var selected=selectedItems.length?selectedItems[selectedItems.length-1]:null;
		var value=selected?parseInt(selected.getAttribute('rel'),10):parseInt(slider.getAttribute('data-default'),10);
		var limit=parseInt(slider.getAttribute('data-limit'),10);
		if(value>limit){value=limit;}
		if(isNaN(value)){value=0;}
		slider.setAttribute('aria-valuenow',String(value));
		slider.setAttribute('aria-valuetext',(value/100)+'%');
	}

	function enhanceEnergy(root){
		root.querySelectorAll('.select_energy').forEach(function(slider){
			if(slider.dataset.a11yReady){updateEnergy(slider);return;}
			slider.dataset.a11yReady='true';
			slider.setAttribute('role','slider');
			slider.tabIndex=0;
			slider.setAttribute('aria-label',document.documentElement.lang==='ru'?'Энергия награды':'Award energy');
			slider.setAttribute('aria-valuemin',slider.getAttribute('data-min')||'0');
			slider.setAttribute('aria-valuemax',slider.getAttribute('data-limit')||slider.getAttribute('data-max')||'10000');
			updateEnergy(slider);
			slider.addEventListener('keydown',function(e){
				var keys=['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'];
				if(keys.indexOf(e.key)===-1){return;}
				e.preventDefault();
				var min=parseInt(slider.getAttribute('data-min'),10)||0;
				var step=parseInt(slider.getAttribute('data-step'),10)||1;
				var max=parseInt(slider.getAttribute('data-limit'),10)||parseInt(slider.getAttribute('data-max'),10)||10000;
				var now=parseInt(slider.getAttribute('aria-valuenow'),10)||min;
				var next=e.key==='Home'?min:e.key==='End'?max:now+((e.key==='ArrowLeft'||e.key==='ArrowDown')?-step:step);
				next=Math.max(min,Math.min(max,next));
				var target=slider.querySelector('.energy_active[rel="'+next+'"]')||slider.querySelector('.energy_active:last-of-type');
				if(target){target.click();setTimeout(function(){updateEnergy(slider);},0);}
			});
			slider.addEventListener('click',function(){setTimeout(function(){updateEnergy(slider);},0);});
		});
	}

	function focusables(modal){
		return Array.prototype.filter.call(modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'),function(el){
			return !el.disabled&&el.getAttribute('aria-hidden')!=='true'&&el.getClientRects().length>0;
		});
	}

	function enhanceModals(root){
		root.querySelectorAll('.modal').forEach(function(modal){
			if(enhancedModals.has(modal)){return;}
			enhancedModals.add(modal);
			modal.setAttribute('role','dialog');
			modal.setAttribute('aria-modal','true');
			modal.tabIndex=-1;
			var heading=modal.querySelector('.header-line');
			if(heading){
				if(!heading.id){heading.id='vizonator-dialog-title-'+(++modalCounter);}
				modal.setAttribute('aria-labelledby',heading.id);
			}
			modal.querySelectorAll('.close-modal-action').forEach(function(close){
				close.setAttribute('aria-label',document.documentElement.lang==='ru'?'Назад':'Back');
			});
			setTimeout(function(){
				var items=focusables(modal);
				(items[0]||modal).focus();
			},0);
		});
	}

	function enhance(){
		var lang=(typeof settings!=='undefined'&&settings&&settings.lang)||localStorage.getItem('lang')||document.documentElement.lang||'en';
		document.documentElement.lang=lang;
		enhanceControls(document);
		enhanceEnergy(document);
		enhanceModals(document);
	}

	document.addEventListener('pointerdown',function(e){
		if(!e.target.closest('.modal')){lastTrigger=e.target.closest('a,button,input,[tabindex]')||document.activeElement;}
	},true);
	document.addEventListener('click',function(e){
		if(!e.target.closest('.modal')){lastTrigger=e.target.closest('a,button,input,[tabindex]')||document.activeElement;}
		setTimeout(enhance,0);
	},true);
	document.addEventListener('keydown',function(e){
		var modal=document.querySelector('.modal');
		if(e.key==='Enter'||e.key===' '){
			var button=e.target.closest('[role="button"]');
			if(button&&button.tagName!=='BUTTON'){e.preventDefault();button.click();return;}
		}
		if(!modal){return;}
		if(e.key==='Escape'){
			var close=modal.querySelector('.close-modal-action');
			if(close){e.preventDefault();close.click();}
			return;
		}
		if(e.key==='Tab'){
			var items=focusables(modal);
			if(!items.length){e.preventDefault();modal.focus();return;}
			var first=items[0],last=items[items.length-1];
			if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
			else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
		}
	},true);

	var observer=new MutationObserver(function(records){
		var removedModal=false;
		records.forEach(function(record){
			record.removedNodes.forEach(function(node){
				if(node.nodeType===1&&(node.matches('.modal')||node.querySelector('.modal'))){removedModal=true;}
			});
		});
		enhance();
		if(removedModal&&lastTrigger&&document.contains(lastTrigger)){setTimeout(function(){lastTrigger.focus();},0);}
	});
	document.addEventListener('DOMContentLoaded',function(){
		enhance();
		observer.observe(document.body,{childList:true,subtree:true});
	});
})();
