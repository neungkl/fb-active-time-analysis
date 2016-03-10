var express = require('express');
var ejs = require("ejs");
var request = require("request");
var fs = require("fs");
var db = require("mongojs")("localhost:27017/facebookactive",["list","log","fetch"]);
var app = express();

var access_token = "";
var fetch_interval = 0;

app.set("view engine","ejs");
app.use(express.static(__dirname+'/views'));

function add_user( id,res,rec ) {
	if( rec ==  "-1" ) {
		res = {};
		res.redirect = function(){};
	}
	request("https://graph.facebook.com/v2.2/"+id+"?access_token="+access_token,function(err,response,body) {
		if( !err && response.statusCode == 200 ) {
			body = JSON.parse( body );
			db.collection("list").count({id:id},function(e,r){
				if( r == 0 ) {
					db.collection("list").insert({
	 					id: id,
	 					name : body.name,
	 					fistActive : false,
	 					fetch: {
	 						commentId : "init"
	 					},
	 					removed : false,
	 					isFinish : false,
	 					isCollecting : false,
	 					isActive : false
	 				},function(e,r){
	 					if( e ) res.redirect(rec+"?err=1");
	 					else res.redirect(rec);
 					});
				} else {
					res.redirect(rec+"?err=4");
				}
			});
		} else {
			res.redirect(rec+"?err=3");
		}
	});
}

function re_featch_data() {
	fetch_interval = setTimeout( fetch_data, 100 );
}

var isFinished = false;

function fetch_data() {
	db.collection("log").find({name:"status"},function(e,r) {
		if( e ) {
			re_featch_data();
			return ;
		}
		if( r[0].status == "start" ) {

			db.collection("list").find({isActive:true,isFinish:false},function(e1,r1) {
				if( e1 ) {
					fs.appendFile("log/log.txt","e1::"+"<br>\n",function(){});
					re_featch_data();
					return ;
				}

				if( r1.length == 0 ) {
					isFinished = true;
					if( !isFinished ) {
						fs.appendFile("log/log.txt","fetch_complete::Complete<br>\n",function(){});
						console.log("fetch complete.");
					}
					re_featch_data();
					return ;
				}

				var data = r1[ Math.floor(Math.random()*r1.length) ];
				isFinished = false;

				var page_id = data.id;

				var page_request = "https://graph.facebook.com/"+page_id+"/posts?fields=id&limit=1&access_token="+access_token;
				if( data.fetch.commentId != "init" ) {
					page_request = data.fetch.commentId+"&access_token="+access_token;
				}
				request(page_request,
				function(err,head,res) {
					if( err ) {
						fs.appendFile("log/log.txt","err1::"+err.toString()+"<br>\n",function(){});
						re_featch_data();
						return ;
					}

					res = JSON.parse( res );

					if( res.data.length == 0 ) {
						db.collection("list").update( { id: page_id }, { $set: { isFinish : true } },
						function(){
							re_featch_data();
						});
						return ;
					}

					var comment_id = res.data[0].id;
					var next_page = res.paging.next;

					request("https://graph.facebook.com/"+comment_id+"?fields=comments.limit(1000000){created_time}&access_token="+access_token,
					function(err2,head2,res2) {
						if( err2 ) {
							fs.appendFile("log/log.txt","err2::"+err2.toString()+"<br>\n",function(){});
							re_featch_data();
							return ;
						}
						var raw_data = JSON.parse( res2 );
						var times_data = [];

						var finished = (next_page === undefined);

						if( raw_data.comments === undefined ) {
							fs.appendFile("log/log.txt","no_comment::"+page_id+"::"+comment_id+"<br>\n",function(){});
							db.collection("list").update( { id: page_id }, { $set: { "fetch.commentId" : next_page, isFinish : finished } }, function(){
								re_featch_data();
							});
							return ;
						}

						for( i in raw_data.comments.data ) {
							times_data.push( raw_data.comments.data[i].created_time );
						}

						db.collection("fetch").insert({
							page_id : page_id,
							comment_id : comment_id,
							times : times_data
						},function(){});
						db.collection("list").update( { id: page_id }, { $set: { "fetch.commentId" : next_page, isFinish : finished } }, function(){} );

						fs.appendFile("log/log.txt","fetch_one::"+page_id+"::"+comment_id+"<br>\n",function(){});

						re_featch_data();
					});

				});
			});
		} else {
			console.log("pause fetch");
			//pause fetch
		}
	});
}

function fetch_log( res ) {
	fs.readFile("log/log.txt",function(err,data) {
		res.send( data );
	});
}

function init() {
	// db.collection('list').remove();
	// db.collection('fetch').remove();
	// db.collection('log').remove();
	// db.collection("list").update({},{$set:{isFinish:false,"fetch.commentId":"init"}},function(){});
	db.collection("log").count({},function(e,r){
		if( r == 0 ) {
			db.collection("log").insert({name:"status",status:"stop"},function(){});
		}
	});
}

app.get('/', function (req, res) {
	db.collection('list').find({"removed":false},function(err,result) {
		if( err ) { result = []; }
		var errNum = 0;
		if( req.query.err ) errNum = req.query.err;
		res.render("index.ejs",{'list':result,'err':errNum});
	});
});

app.get( '/analysis',function(req,res) {

	if( req.query.log ) {
		fetch_log( res );
		return ;
	}

	db.collection("log").find({name:"status"},function(err,result) {
		if( err || result == "" || !result ) box = "error";
		box = result[0].status;
		db.collection('list').find({isActive:true},function(err2,result2) {
			if( err2 ) { result2 = []; }
			res.render("analysis.ejs",{'list':result2,'box':box});
		});
	});

});

app.get("/statistic",function(req,res) {

	if( req.query.cache != 0 ) {
		db.collection("log").find({name:"final_data"},function(e,r) {
			res.render("statistic.ejs",{data:JSON.stringify(r[0].data)});
		});
		return ;
	}

	db.collection("fetch").find({},function(err,result) {
		console.log("load complete");
		var tmp_time;
		var raw_data = [];
		var column = 20;
		for( var i=0; i<24; i++ ) {
			raw_data[i] = [];
			for( var j=0; j<column; j++ ) {
				raw_data[i][j] = 0;
			}
		}

		var count = 0;

		for( var i=0; i<result.length; i++ ) {
			count += result[i].times.length;
			for( var j=0; j<result[i].times.length; j++ ) {
				tmp_time = new Date( result[i].times[j] );
				raw_data[ tmp_time.getHours() ][ Math.floor(tmp_time.getMinutes()/(60/column)) ]++;
				// if( tmp_time.getHours() == 21 && Math.floor(tmp_time.getMinutes()/(60/column)) == 28 ) {
				//  	check = 1;
				//  	cc_count++;
				// }
			}
		}

		console.log("data send : "+count+" query");

		db.collection("log").update({name:"final_data"},{$set:{data:raw_data}},function(){});
		res.render("statistic.ejs",{data:JSON.stringify(raw_data)});
	});
});

app.get('/query',function(req,res) {

 	if( req.query.type == "add" ) {
 		add_user( req.query.id, res, "." );
 	} else if( req.query.type == "remove" ) {
 		db.collection("list").update({id: req.query.id},{$set:{"removed":true}},function(e,r){
 			if( e ) res.redirect(".?err=2");
 			else res.redirect(".");
 		});
 	} else if( req.query.type == "active" ) {
 		db.collection("list").count( {id:req.query.id, firstActive:true}, function(e,r) {
			if( e ) {
				res.redirect(".?err=2");
				return ;
			}
			if( r == 0 ) {
		 		request("https://graph.facebook.com/v2.2/"+req.query.id+"/likes?access_token="+access_token,function(err,response,body) {
		 			if( !err && response.statusCode == 200 ) {
		 				body = JSON.parse(body);

 						db.collection("list").update( {id:req.query.id},{$set:{isActive:true, firstActive:true}},function(){});
		 				for( var i=0; i<body.data.length; i++ ) {
		 					if( i == body.data.length-1 ) {
		 						add_user( body.data[i].id,res,"." );
		 					} else {
		 						add_user( body.data[i].id,res,"-1" );
		 					}
		 				}
		 				if( body.data.length == 0 ) res.redirect(".");

		 			} else {
		 				res.redirect(".?err=3");
		 			}
		 		});
			} else {
				db.collection("list").update( {id:req.query.id},{$set:{isActive:true}},function(){
					res.redirect(".");
				});
			}
		});
 	} else if( req.query.type == "unactive" ) {
 		db.collection("list").update( {id:req.query.id},{$set:{isActive:false}},function(e,r) {
 			if( e ) res.redirect(".?err=2");
 			else res.redirect(".");
 		});
 	} else if( req.query.type == "start_fetch" ) {
 		db.collection("log").update({name:"status"},{$set:{status:"start"}},function(e,r) {
 			if( !e ) {
 				res.redirect("./analysis");
 				fetch_interval = setTimeout( fetch_data, 0 );
 			} else {
 				res.redirect("./analysis");
 			}
 		});
 	} else if( req.query.type == "stop_fetch" ) {
 		db.collection("log").update({name:"status"},{$set:{status:"stop"}},function(e,r) {
 			res.redirect("./analysis");
 		});
 	} else {
		res.redirect(".");
	}
});

app.listen(8001, function() {
	console.log('Web start at port 8001');
});
init();
