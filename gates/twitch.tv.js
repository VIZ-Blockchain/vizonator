if(typeof vizonator == 'undefined'){
	//window outer 500 250
	//window inner 464 234 (-36 in height and -16 in width)
	var action_width=250+16;
	var action_height=450+36;
	var vizonator=true;
	var vizonator_location=window.location.href+window.location.hash;
	var vizonator_counter=1;
	var vizonator_icon='<?xml version="1.0" encoding="UTF-8" standalone="no"?><svg class="vizonator_icon" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="19" height="19" viewBox="0 0 32.000001 31.999999" version="1.1" id="svg819"><metadata id="metadata825"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" /><dc:title></dc:title></cc:Work></rdf:RDF></metadata><defs id="defs823"><linearGradient id="linearGradient825"><stop style="stop-color:#00baff;stop-opacity:1" offset="0" id="stop821" /><stop style="stop-color:#0040d8;stop-opacity:1" offset="1" id="stop823" /></linearGradient><linearGradient xlink:href="#linearGradient825" id="linearGradient827" x1="290" y1="517.36218" x2="314.89999" y2="517.36218" gradientUnits="userSpaceOnUse" /><linearGradient xlink:href="#linearGradient825" id="linearGradient829" gradientUnits="userSpaceOnUse" x1="314.89999" y1="507.36221" x2="295.32346" y2="524.41736" gradientTransform="matrix(1.468555,0,0,1.468555,-135.88094,-247.09818)" /></defs><sodipodi:namedview pagecolor="#ffffff" bordercolor="#666666" borderopacity="1" objecttolerance="10" gridtolerance="10" guidetolerance="10" id="namedview821" showgrid="false" fit-margin-top="0" fit-margin-left="0" fit-margin-right="0" fit-margin-bottom="0"></sodipodi:namedview><g id="g867" transform="translate(0.4620026,7.4640002)"><g id="g832" transform="translate(0.91872047,-1.7216066)"><g transform="matrix(0.79958833,0,0,0.79958833,-231.88062,-399.67266)" id="g817" style="fill:url(#linearGradient827);fill-opacity:1;stroke:none;stroke-opacity:1"><path style="fill:url(#linearGradient829);fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:1.46855497;stroke-opacity:1" d="m 290,502.39677 17.4758,24.96543 19.09122,-29.3711 z" id="path815" /></g><path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:1.88098109px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1" d="M 18.387608,0.22326273 9.6175995,9.6281686 h 5.5371295 l -4.291047,7.5239234 8.875825,-9.4049041 h -5.642944 z" id="path862" sodipodi:nodetypes="ccccccc" /></g></g></svg>';
	var vizonator_css=`
<style type="text/css">
.vizonator_icon{
	vertical-align:bottom;
}
.vizonator_div{
	margin:6px 0;
	font-family:system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif;
}
.vizonator_button{
	cursor:pointer;
	display:inline-block;
	background:#fff;
	padding:4px 10px;
	padding-left:6px;
	border-radius:10px;
	border:1px solid #aaa;
	color:#222;
	font-size:14px;
	line-height:22px;
	box-shadow:0 2px 4px -1px rgba(0,0,0,0.3);
	-webkit-transition: all 0.2s linear;
	-moz-transition: all 0.2s linear;
	-o-transition: all 0.2s linear;
	transition: all 0.2s linear;
}
.vizonator_status{
	display:inline-block;
	display:none;
	margin:0;
	padding:0;
	margin:0 12px;
	margin-left:6px;
	font-size:14px;
	color:#657786;
}
</style>
`;
	function wait_loading(selector,attr='',value='',callback){
		if($(selector).length>0){
			if(''!=attr){
				console.log('selector '+selector+', attr '+attr+':'+$(selector).attr(attr));
				if(value!=$(selector).attr(attr)){
					callback();
				}
				else{
					setTimeout(function(){wait_loading(selector,attr,value,callback)},1000);
				}
			}
			else{
				callback();
			}
		}
		else{
			setTimeout(function(){wait_loading(selector,attr,value,callback)},1000);
		}
	}
	function append_css(){
		$('head').append(vizonator_css);
	}
	function location_timer(){
		if(vizonator_location!=window.location.href+window.location.hash){
			vizonator_location=window.location.href+window.location.hash;
			setTimeout(function(){init_page()},1000);
		}
		setTimeout(function(){location_timer()},250);
	}
	function vizonator_button_click(e){
		e.preventDefault();
		e.stopPropagation();
		let login='social';
		let sequence=4;
		let item_link=$(this).closest('article').find('time:first').closest('a').attr('href');
		if(typeof item_link === 'undefined'){
			item_link=window.location.pathname;
		}
		item_link=item_link.split('/');
		let user_name=item_link[1];
		let memo=user_name;
		let id=$(this).attr('data-id');
		let beneficiaries=decodeURIComponent('[]');
		let action_top = Math.round(window.screenY + (window.outerHeight / 2) - (action_height / 2))
		let action_left = Math.round(window.screenX + (window.outerWidth / 2) - (action_width / 2))
		chrome.runtime.sendMessage({vizonator:true,id,login,sequence,memo,beneficiaries,action_top,action_left,action_width,action_height});
	}
	function vizonator_callback_message(){
		chrome.runtime.onMessage.addListener(function(request,sender,sendResponse){
			console.log(sender);
			if(!sender.tab){
				console.log(request);
				let status_el=$('.vizonator_button[data-id="'+parseInt(request.id)+'"]').parent().find('.vizonator_status');
				console.log(status_el);
				if(request.status){
					let sum=parseFloat(status_el.attr('data-sum'));
					if(Number.isNaN(sum)){
						sum=0;
					}
					sum=sum+parseFloat(request.approximate_amount);
					status_el.attr('data-sum',sum);
					status_el.html('~'+sum.toFixed(6)+' VIZ SHARES');
				}
				else{
					status_el.html('<span style="color:#f00;">Refused</span>');
				}
				status_el.css('display','inline-block');
			}
		});
	}
	function continuously_view(){
		$('.channel-info-content h3').each(function(i,el){
			if(!$(el).hasClass('activated_vizonator')){
				$(el).addClass('activated_vizonator');
				$(el).parent().parent().append('<div class="vizonator_div"><div class="vizonator_button" data-id="'+vizonator_counter+'">'+vizonator_icon+' Award</div><div class="vizonator_status"></div></div>');
				$('.vizonator_button[data-id="'+vizonator_counter+'"]').off('click');
				$('.vizonator_button[data-id="'+vizonator_counter+'"]').on('click',vizonator_button_click);
				vizonator_counter++;
			}
		});
		setTimeout(function(){continuously_view()},2500);
	}
	function init_page(){
		wait_loading('.channel-info-content','','',function(){
			continuously_view();
		});
	}
	$(function(){
		append_css();
		location_timer();
		init_page();
		vizonator_callback_message();
	});
}