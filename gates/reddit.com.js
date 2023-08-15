if(typeof vizonator == 'undefined'){
	//window outer 500 250
	//window inner 464 234 (-36 in height and -16 in width)
	var action_width=250+16;
	var action_height=450+36;
	var vizonator=true;
	var vizonator_location=window.location.href+window.location.hash;
	var vizonator_counter=1;
	var vizonator_icon='<?xml version="1.0" encoding="UTF-8" standalone="no"?><svg class="vizonator_icon" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="22" height="22" viewBox="0 0 32.000001 31.999999" version="1.1" id="svg819"><metadata id="metadata825"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" /><dc:title></dc:title></cc:Work></rdf:RDF></metadata><sodipodi:namedview pagecolor="#ffffff" bordercolor="#666666" borderopacity="1" objecttolerance="10" gridtolerance="10" guidetolerance="10" id="namedview821" showgrid="false" fit-margin-top="0" fit-margin-left="0" fit-margin-right="0" fit-margin-bottom="0"></sodipodi:namedview><g id="g867" transform="translate(0.4620026,7.4640002)"><g id="g832" transform="translate(0.91872047,-1.7216066)"><g transform="matrix(0.79958833,0,0,0.79958833,-231.88062,-399.67266)" id="g817" style="fill:#0084ff;fill-opacity:1;stroke:none;stroke-opacity:1"><path style="fill:#0084ff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:1.46855497;stroke-opacity:1" d="m 290,502.39677 17.4758,24.96543 19.09122,-29.3711 z" id="path815" /></g><path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:1.88098109px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1" d="M 18.387608,0.22326273 9.6175995,9.6281686 h 5.5371295 l -4.291047,7.5239234 8.875825,-9.4049041 h -5.642944 z" id="path862" sodipodi:nodetypes="ccccccc" /></g></g></svg>';
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
	margin-left:5px;
	padding:2px 10px;
	padding-left:6px;
	border-radius:10px;
	border:1px solid #aaa;
	color:#222;
	font-size:12px;
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
	margin-left:8px;
	font-size:12px;
	color:#657786;
	top:-2px;
	position:relative;
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

		if(false===comment_selector){
			if(0<$('i.icon.icon-comment').length){
				$('i.icon.icon-comment').each(function(i,el){
					if('Reply'==$(el).parent().text()){
						comment_selector=$(el).parent().parent().parent().parent().prop('class');
					}
				});
				if('undefined' == comment_selector){
					comment_selector=false;
				}
				else
				if('undefined' === typeof comment_selector){
					comment_selector=false;
				}
				else
				if(''===comment_selector){
					comment_selector=false;
				}
				else{
					comment_selector='.'+comment_selector;
					if(-1!=comment_selector.indexOf(' ')){
						comment_selector=comment_selector.substring(0,comment_selector.indexOf(' '));
					}
				}
			}
		}

		let login='social';
		let sequence=8;

		let author=$(this).closest(comment_selector).find('a')[0].innerHTML;

		let item_link=$(this).closest(comment_selector).find('a')[1].getAttribute('href');
		if(-1!=item_link.indexOf('?')){
			item_link=item_link.substring(0,item_link.indexOf('?'));
		}
		if(-1!=item_link.indexOf('reddit.com/')){
			item_link=item_link.substring(item_link.indexOf('reddit.com/')+11);
		}
		let memo=author;
		item_link=item_link.split('/');

		console.log(item_link)
		//https://www.reddit.com/r/hearthstone/comments/p/*/c/
		if('r'==item_link[0]){
			memo+=' r='+item_link[1];
		}
		if('comments'==item_link[2]){
			memo+=' p='+item_link[3];
		}
		if(typeof item_link[5] !== 'undefined'){
			memo+=' c='+item_link[5];
		}

		let id=$(this).attr('data-id');
		let beneficiaries='[]';
		let action_top = Math.round(window.screenY + (window.outerHeight / 2) - (action_height / 2))
		let action_left = Math.round(window.screenX + (window.outerWidth / 2) - (action_width / 2))
		chrome.runtime.sendMessage({vizonator:true,id,login,sequence,memo,beneficiaries,action_top,action_left,action_width,action_height});
	}
	function vizonator_button_click2(e){
		e.preventDefault();
		e.stopPropagation();
		let login='social';
		let sequence=8;

		let author='';
		let link_num=0;
		while(''==author){
			let link_parts=$(this).closest(post_selector).find('a')[link_num].getAttribute('href').split('/');
			if('user'==link_parts[1]){
				author=link_parts[2];
			}
			else{
				link_num++;
			}
		}
		if(-1!=author.indexOf('/')){
			author=author.substr(author.indexOf('/')+1);
		}

		let item_link=$(this).closest(post_selector).find('a')[link_num+1].getAttribute('href');
		if(-1!=item_link.indexOf('?')){
			item_link=item_link.substring(0,item_link.indexOf('?'));
		}
		if(-1!=item_link.indexOf('reddit.com/')){
			item_link=item_link.substring(item_link.indexOf('reddit.com/')+10);
		}
		let memo=author;
		item_link=item_link.split('/');
		//console.log(item_link)
		if('r'==item_link[1]){
			memo+=' r='+item_link[2];
		}
		if('user'==item_link[1]){
			memo+=' u='+item_link[2];
		}
		if('comments'==item_link[3]){
			memo+=' p='+item_link[4];
		}

		let id=$(this).attr('data-id');
		let beneficiaries='[]';
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
					status_el.html('~'+sum.toFixed(6)+' Ƶ');//VIZ SHARES
				}
				else{
					status_el.html('<span style="color:#f11;">Refused</span>');
				}
				status_el.css('display','inline-block');
			}
		});
	}
	var comment_selector=false;
	var post_selector='.Post';
	var check_pathname=window.location.pathname;
	function continuously_view(){
		if(check_pathname!=window.location.pathname){
			comment_selector=false;
		}
		if(false===comment_selector){
			if(0<$('i.icon.icon-comment').length){
				$('i.icon.icon-comment').each(function(i,el){
					if('Reply'==$(el).parent().text()){
						comment_selector=$(el).parent().parent().parent().parent().prop('class');
					}
				});
				if('undefined' == comment_selector){
					comment_selector=false;
				}
				else
				if('undefined' === typeof comment_selector){
					comment_selector=false;
				}
				else
				if(''===comment_selector){
					comment_selector=false;
				}
				else{
					comment_selector='.'+comment_selector;
					if(-1!=comment_selector.indexOf(' ')){
						comment_selector=comment_selector.substring(0,comment_selector.indexOf(' '));
					}
					else{
						//console.log('VIZONATOR: find comment_selector',comment_selector);
					}
				}
			}
		}
		if(false!==comment_selector){
			$(comment_selector).each(function(i,el){
				if(!$(el).hasClass('activated_vizonator')){
					$(el).addClass('activated_vizonator');
					$(el).find('.vizonator_div').remove();
					$(el).find('button.voteButton').parent().parent().append('<div class="vizonator_div"><div class="vizonator_button" data-id="'+vizonator_counter+'">'+vizonator_icon+' Award</div><div class="vizonator_status"></div></div>');
					$('.vizonator_button[data-id="'+vizonator_counter+'"]').off('click');
					$('.vizonator_button[data-id="'+vizonator_counter+'"]').on('click',vizonator_button_click);
					vizonator_counter++;
				}
			});
		}
		if(false!==post_selector){
			$(post_selector).each(function(i,el){
				if(!$(el).hasClass('activated_vizonator')){
					$(el).addClass('activated_vizonator');
					$(el).find('.vizonator_div').remove();
					$(el).find('i.icon.icon-comment').parent().parent().append('<div class="vizonator_div"><div class="vizonator_button" data-id="'+vizonator_counter+'">'+vizonator_icon+' Award</div><div class="vizonator_status"></div></div>');
					$('.vizonator_button[data-id="'+vizonator_counter+'"]').off('click');
					$('.vizonator_button[data-id="'+vizonator_counter+'"]').on('click',vizonator_button_click2);
					vizonator_counter++;
				}
			});
		}

		setTimeout(function(){continuously_view()},1000);
	}
	function init_page(){
		wait_loading('body','','',function(){
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