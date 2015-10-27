'use strict';
// (4.22208334636).fixed(n) will return fixed point value to n places, default n = 3

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

Number.prototype.fixed = function (n_) {
    n_ = n_ || 3;return parseFloat(this.toFixed(n_));
};

var Common = (function () {
    function Common() {
        _classCallCheck(this, Common);

        //The speed at which the clients move.
        this.avatarspeed = 120;
        this.owntime_ = 0.016;
        this.world = { width: 720, height: 480 };
    }

    /*
     Shared between server and client.
     In this example, `item` is always of type avatar.
     */

    _createClass(Common, [{
        key: 'check_collision',
        value: function check_collision(item_) {
            if (item_.pos.x < item_.pos_limits.x_min || item_.pos.x > item_.pos_limits.x_max) {
                item_.pos.x = Math.min(Math.max(item_.pos.x, item_.pos_limits.x_min), item_.pos_limits.x_max);
            }
            if (item_.pos.y < item_.pos_limits.y_min || item_.pos.y > item_.pos_limits.y_max) {
                item_.pos.y = Math.min(Math.max(item_.pos.y, item_.pos_limits.y_min), item_.pos_limits.y_max);
            }
            //Fixed point helps be more deterministic
            item_.pos.x = item_.pos.x.fixed(4);
            item_.pos.y = item_.pos.y.fixed(4);
        }
    }, {
        key: 'process_input',
        value: function process_input(avatar_) {
            //It's possible to have recieved multiple inputs by now,
            //so we process each one
            var x_dir = 0;
            var y_dir = 0;
            var ic = avatar_.inputs.length;
            if (ic) //if we have inputs
                {
                    for (var j = 0; j < ic; ++j) //for each input command
                    {
                        //don't process ones we already have simulated locally
                        if (avatar_.inputs[j].seq <= avatar_.last_input_seq) {
                            continue;
                        }

                        var input = avatar_.inputs[j].inputs;
                        var c = input.length;
                        for (var i = 0; i < c; ++i) //for all input values
                        {
                            var key = input[i];
                            if (key == 'l') {
                                x_dir -= 1;
                            }
                            if (key == 'r') {
                                x_dir += 1;
                            }
                            if (key == 'd') {
                                y_dir += 1;
                            }
                            if (key == 'u') {
                                y_dir -= 1;
                            }
                        }
                    }
                }

            //we have a direction vector now, so apply the same physics as the client
            var resulting_vector = this.physics_movement_vector_from_direction(x_dir, y_dir);
            if (avatar_.inputs.length) {
                //we can now clear the array since these have been processed
                avatar_.last_input_time = avatar_.inputs[ic - 1].time;
                avatar_.last_input_seq = avatar_.inputs[ic - 1].seq;
            }

            //give it back
            return resulting_vector;
        }
    }, {
        key: 'physics_movement_vector_from_direction',
        value: function physics_movement_vector_from_direction(x_, y_) {
            //Must be fixed step, at physics sync speed.
            return { x: (x_ * (this.avatarspeed * 0.015)).fixed(3),
                y: (y_ * (this.avatarspeed * 0.015)).fixed(3) };
        }
    }, {
        key: 'start_physics_loop',
        value: function start_physics_loop(component_) {
            var _this = this;

            //Set up some physics integration values
            this._pdt = 0.0001; //The physics update delta time
            this._pdte = new Date().getTime(); //The physics update last delta time
            //A local timer for precision on server and client
            this.owntime_ = 0.016; //The local timer
            this._dt = new Date().getTime(); //The local timer delta
            this._dte = new Date().getTime(); //The local timer last frame time

            //Start a physics loop, this is separate to the rendering
            //as this happens at a fixed frequency
            setInterval(function () {
                _this._pdt = (new Date().getTime() - _this._pdte) / 1000.0;
                _this._pdte = new Date().getTime();
                component_.update_physics(_this._pdt);
            }, 15);

            //Start a fast paced timer for measuring time easier
            setInterval(function () {
                _this._dt = new Date().getTime() - _this._dte;
                _this._dte = new Date().getTime();
                _this.set_owntime(_this.owntime_ + _this._dt / 1000.0);
            }, 4);
        }
    }, {
        key: 'set_owntime',
        value: function set_owntime(v_) {
            if (v_) {
                this.owntime_ = v_;
            }
        }
    }, {
        key: 'get_owntime',
        value: function get_owntime() {
            return this.owntime_;
        }

        /*
         Helper functions for the session code
           Here we have some common maths and session related code to make working with 2d vectors easy,
         as well as some helpers for rounding numbers to fixed point.
         */
        //copies a 2d vector like object from one to another
    }, {
        key: 'new_pos',
        value: function new_pos(a_) {
            return { x: a_.x, y: a_.y };
        }

        //Add a 2d vector with another one and return the resulting vector
    }, {
        key: 'v_add',
        value: function v_add(a_, b_) {
            return { x: (a_.x + b_.x).fixed(), y: (a_.y + b_.y).fixed() };
        }

        //Subtract a 2d vector with another one and return the resulting vector
    }, {
        key: 'v_sub',
        value: function v_sub(a_, b_) {
            return { x: (a_.x - b_.x).fixed(), y: (a_.y - b_.y).fixed() };
        }

        //Multiply a 2d vector with a scalar value and return the resulting vector
    }, {
        key: 'v_mul_scalar',
        value: function v_mul_scalar(a_, b_) {
            return { x: (a_.x * b_).fixed(), y: (a_.y * b_).fixed() };
        }

        //Simple linear interpolation
    }, {
        key: 'lerp',
        value: function lerp(p_, n_, t_) {
            var t = Number(t_);t = Math.max(0, Math.min(1, t)).fixed();return (p_ + t * (n_ - p_)).fixed();
        }

        //Simple linear interpolation between 2 vectors
    }, {
        key: 'v_lerp',
        value: function v_lerp(v_, tv_, t_) {
            return { x: this.lerp(v_.x, tv_.x, t_), y: this.lerp(v_.y, tv_.y, t_) };
        }
    }]);

    return Common;
})();

;

var cm = new Common();

// http://stackoverflow.com/questions/30339675/how-to-map-json-data-to-a-class

/*
 The avatar class
 A simple class to maintain state of a avatar on screen.
*/

var Avatar = function Avatar(socket_) {
    _classCallCheck(this, Avatar);

    //Store the instance, if any
    this.socket = socket_;
    // this.userid = socket_.userid;

    //Set up initial values for our state information
    this.pos = { x: 0, y: 0 };
    this.size = { x: 16, y: 16, hx: 8, hy: 8 };
    this.state = 'not-connected';
    this.color = 'rgba(255,255,255,0.1)';
    this.info_color = 'rgba(255,255,255,0.1)';
    this.id = '';
    //These are used in moving us around later
    this.old_state = { pos: { x: 0, y: 0 } };
    this.cur_state = { pos: { x: 0, y: 0 } };
    this.state_time = new Date().getTime();
    //Our local history of inputs
    this.inputs = [];
    //The world bounds we are confined to
    this.pos_limits = { x_min: this.size.hx,
        x_max: cm.world.width - this.size.hx,
        y_min: this.size.hy,
        y_max: cm.world.height - this.size.hy };
    //The 'host' of a session gets created with a avatar instance since
    //the server already knows who they are. If the server starts a session
    //with only a host, the other avatar is set up in the 'else' below
    if (this.socket) {
        this.pos = { x: 20, y: 20 };
    } else {
        this.pos = { x: 500, y: 200 };
    }
};

;

var SvModel = (function () {
    function SvModel() {
        _classCallCheck(this, SvModel);
    }

    _createClass(SvModel, [{
        key: 'get_avatar_json',
        value: function get_avatar_json() {
            var avatar = new Avatar();
            avatar.state_time = 0;

            return JSON.stringify(avatar);
        }
    }]);

    return SvModel;
})();

;

var SvSession = (function () {
    function SvSession(socket_, cl_id_) {
        _classCallCheck(this, SvSession);

        var UUID = require('node-uuid');
        this.id = UUID(); // generate a new id for the session

        this.socket_host = socket_; // so we know who initiated the session
        this.socket_client = null; // nobody else joined yet, since its new
        this.avatar_count = 1;

        this.frame_time_ = 45; //on server we run at 45ms, 22hz
        this.sv_time = 0;
        this.last_time = 0;
        this.laststate = {};

        // Model distribution
        var sv_mdl = new SvModel();
        sv_mdl.get_avatar_json();

        //We create a avatar set, passing them
        //the session that is running them, as well
        this.avatars = [new Avatar(this.socket_host), new Avatar(this.socket_client)];

        this.avatars[0].pos = { x: 20, y: 20 };
        cm.start_physics_loop(this);

        // initialize host
        //tell the avatar that they are now the host
        //s=server message, h=you are hosting
        this.socket_host.send('s.h.' + String(cm.get_owntime()).replace('.', '-'));
    }

    //Main update loop

    _createClass(SvSession, [{
        key: 'update',
        value: function update(t_) {
            var _this2 = this;

            //Update the session specifics
            //Update the state of our local clock to match the timer
            this.sv_time = cm.get_owntime();

            this.laststate = { pos: this.avatars.map(function (a_) {
                    return a_.pos;
                }),
                inp_seq: this.avatars.map(function (a_) {
                    return a_.last_input_seq;
                }),
                t: this.sv_time }; // our current local time on the server

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.avatars[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var avatar = _step.value;
                    if (avatar.socket) {
                        avatar.socket.emit('onserverupdate', this.laststate);
                    }
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator['return']) {
                        _iterator['return']();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            var currTime = Date.now(),
                timeToCall = Math.max(0, this.frame_time_ - (currTime - this.last_time));

            //schedule the next update
            this.updateid = setTimeout(function () {
                _this2.update(currTime + timeToCall);
            }, timeToCall);
            this.last_time = currTime + timeToCall;
        }
    }, {
        key: 'stop',
        value: function stop(user_id_) {
            clearTimeout(this.updateid);

            //if the session has two avatars, the one is leaving
            if (this.avatar_count > 1) {
                //send the avatars the message the session is ending
                if (user_id_ == this.socket_host.userid) {
                    //the host left, oh snap. Lets try join another session
                    if (this.socket_client) {
                        //tell them the session is over
                        this.socket_client.send('s.e');
                        //now look for/create a new session.
                        return this.socket_client;
                    }
                } else {
                    //the other avatar left, we were hosting
                    if (this.socket_host) {
                        //tell the client the session is ended
                        this.socket_host.send('s.e');
                        //i am no longer hosting, this session is going down
                        //now look for/create a new session.
                        return this.socket_host;
                    }
                }
            }
            return null;
        }
    }, {
        key: 'try_to_start',
        value: function try_to_start(cl_socket_, cl_id_) {
            //If the session is a avatar short
            if (this.avatar_count >= 2) {
                return false;
            } //if more than 2 avatars

            //increase the avatar count and store
            //the avatar as the client of this session
            this.socket_client = cl_socket_;
            this.avatars[1].socket = cl_socket_;
            this.avatar_count++;

            //start running the session on the server,
            //which will tell them to respawn/start
            this.start();
            return true;
        }
    }, {
        key: 'start',
        value: function start() {
            //right so a session has 2 avatars and wants to begin
            //the host already knows they are hosting,
            //tell the other client they are joining a session
            //s=server message, j=you are joining, send them the host id
            this.socket_client.send('s.j.' + this.socket_host.userid);
            this.socket_client.session = this;

            //now we tell both that the session is ready to start
            //clients will reset their positions in this case.
            this.socket_client.send('s.r.' + String(cm.get_owntime()).replace('.', '-'));
            this.socket_host.send('s.r.' + String(cm.get_owntime()).replace('.', '-'));
        }

        //Updated at 15ms , simulates the world state
    }, {
        key: 'update_physics',
        value: function update_physics(pdt_) {
            //Handle avatars
            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = this.avatars[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var avatar = _step2.value;

                    avatar.old_state.pos = cm.new_pos(avatar.pos);
                    avatar.pos = cm.v_add(avatar.old_state.pos, cm.process_input(avatar));
                }

                //Keep the physics position in the world
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2['return']) {
                        _iterator2['return']();
                    }
                } finally {
                    if (_didIteratorError2) {
                        throw _iteratorError2;
                    }
                }
            }

            var _iteratorNormalCompletion3 = true;
            var _didIteratorError3 = false;
            var _iteratorError3 = undefined;

            try {
                for (var _iterator3 = this.avatars[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                    var avatar = _step3.value;

                    cm.check_collision(avatar);
                    avatar.inputs = [];
                }
            } catch (err) {
                _didIteratorError3 = true;
                _iteratorError3 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion3 && _iterator3['return']) {
                        _iterator3['return']();
                    }
                } finally {
                    if (_didIteratorError3) {
                        throw _iteratorError3;
                    }
                }
            }
        }
    }, {
        key: 'handle_input',
        value: function handle_input(cl_, input_, input_time_, input_seq_) {
            //Fetch which client this refers to out of the two
            var input_socket = cl_.userid == this.socket_host.userid ? this.avatars[0] : this.avatars[1];
            //Store the input on the avatar instance for processing in the physics loop
            input_socket.inputs.push({ inputs: input_, time: input_time_, seq: input_seq_ });
        }
    }]);

    return SvSession;
})();

var SvPresenter = (function () {
    function SvPresenter() {
        _classCallCheck(this, SvPresenter);

        //a local queue of packets we delay if faking latency
        this.fake_latency = 0;
        this.packets = [];
        this.sessions = [];
        this.session_count = 0;
        this.verbose = false;
        this.httpd = null;

        // Model definition
        this.model = new SvModel();
    }

    _createClass(SvPresenter, [{
        key: 'init_httpd',
        value: function init_httpd() {
            var _this3 = this;

            var port = process.env.PORT || 4004,
                express = require('express'),
                http = require('http'),
                app = express();
            this.httpd = http.createServer(app);

            /* Express server set up. */

            //The express server handles passing our content to the browser,
            //As well as routing users where they need to go. This example is bare bones
            //and will serve any file the user requests from the root of your web server (where you launch the script from)
            //so keep this in mind - this is not a production script but a development teaching tool.

            //Tell the server to listen for incoming connections
            this.httpd.listen(port);

            //Log something so we know that it succeeded.
            console.log('\t :: Express :: Listening on port ' + port);

            // By default, we forward the / path to index.html automatically.
            app.get('/', function (req_, res_) {
                console.log('trying to load %s', __dirname + '/index.html');
                // let file = req_.path;
                var options = { root: __dirname,
                    dotfiles: 'deny',
                    headers: { 'x-timestamp': Date.now(), 'x-sent': true } };
                // console.log("file = ", file);
                res_.sendFile('/index.html', options, function (err_) {
                    if (err_) {
                        console.log(err_);
                        res_.status(err_.status).end();
                    } else {/* console.log('Sent:', file); */};
                });
            });

            // Model
            app.get('/model', function (req_, res_, next_) {
                if (_this3.verbose) {
                    console.log('\t :: Express :: data requested as model');
                }
                res_.json(_this3.model.get_avatar_json());
            });

            // This handler will listen for requests on /*, any file from the root of our server.
            // See expressjs documentation for more info on routing.

            app.get('/*', function (req_, res_, next_) {
                //This is the current file they have requested
                // let file = req.params[0];

                //Send the requesting client the file.
                // res.sendfile(__dirname + '/' + file);
                var file = req_.path;
                //For debugging, we can track what files are requested.
                if (_this3.verbose) {
                    console.log('\t :: Express :: file requested : ' + file);
                }
                var options = { root: __dirname + '/',
                    dotfiles: 'deny',
                    headers: { 'x-timestamp': Date.now(), 'x-sent': true } };
                // console.log("file = ", file);
                res_.sendFile(file, options, function (err_) {
                    if (err_) {
                        console.log(err_);
                        res_.status(err_.status).end();
                    } else {/* console.log('Sent:', file); */}
                });
            });
        }
    }, {
        key: 'init_socket',
        value: function init_socket() {
            var _this4 = this;

            /* Socket.IO server set up. */

            //Express and socket.io can work together to serve the socket.io client files for you.
            //This way, when the client requests '/socket.io/' files, socket.io determines what the client needs.

            //Create a socket.io instance using our express server
            var io = require('socket.io'),
                UUID = require('node-uuid'),
                sio = io.listen(this.httpd);

            //Configure the socket.io connection settings.
            //See http://socket.io/
            sio.use(function (socket_, next_) {
                var handshake = socket_.request;next_();
            });

            //Enter the session server code. The session server handles
            //client connections looking for a session, creating sessions,
            //leaving sessions, joining sessions and ending sessions when they leave.

            //Socket.io will call this function when a client connects,
            //So we can send that client looking for a session to play,
            //as well as give that client a unique ID to use so we can
            //maintain the list if avatars.
            sio.sockets.on('connection', function (socket_) {
                var cl_id = UUID();
                //now we can find them a session to play with someone.
                //if no session exists with someone waiting, they create one and wait.
                var accepted_session = _this4.find_session_(socket_, cl_id);

                //Useful to know when someone connects
                console.log('\t avatar: ' + accepted_session.id + ' connected');

                //// register events
                //Now we want to handle some of the messages that clients will send.
                //They send messages here, and we send them to the sv to handle.
                socket_.on('message', function (msg_) {
                    _this4.on_recv_message_(socket_, cl_id, msg_);
                });

                //When this client disconnects, we want to tell the session server
                //about that as well, so it can remove them from the session they are
                //in, and make sure the other avatar knows that they left and so on.
                socket_.on('disconnect', function () {
                    //Useful to know when soomeone disconnects
                    console.log('\t socket.io:: client disconnected ' + cl_id + ' ' + accepted_session.id);
                    //If the client was in a session, set by sv.find_session_,
                    //we can tell the session server to update that session state.
                    if (socket_ && accepted_session.id) {
                        //avatar leaving a session should destroy that session
                        _this4.destroy_session_(accepted_session.id, cl_id);
                    }
                });
            });
        }
    }, {
        key: 'log_',
        value: function log_() {
            if (this.verbose) {
                console.log.apply(this, arguments);
            }
        }
    }, {
        key: 'on_recv_message_',
        value: function on_recv_message_(socket_, cl_id_, packet_) {
            var _this5 = this;

            if (this.fake_latency && packet_.split('.')[0].substr(0, 1) == 'i') {
                //store all input packet
                this.packets.push({ client: socket_, packet: packet_ });
                setTimeout(function () {
                    if (_this5.packets.length) {
                        _this5.proc_packet_(_this5.packets[0].client, _this5.packets[0].packet);
                        _this5.packets.splice(0, 1);
                    }
                }, this.fake_latency);
                return;
            }
            this.proc_packet_(socket_, packet_);
        }
    }, {
        key: 'proc_packet_',
        value: function proc_packet_(socket_, packet_) {
            //Cut the packet up into sub components
            var packet_parts = packet_.split('.'),

            //The first is always the type of packet
            packet_type = packet_parts[0];

            var other_client = null;
            if (socket_.session.socket_host.userid == socket_.userid) {
                other_client = socket_.session.socket_client;
            } else {
                other_client = socket_.session.socket_host;
            }

            switch (packet_type) {
                case 'i':
                    this.on_input_(socket_, packet_parts);break; // Input handler will forward this
                case 'p':
                    socket_.send('s.p.' + packet_parts[1]);break;
                case 'c':
                    if (other_client) {
                        other_client.send('s.c.' + packet_parts[1]);
                    }break; // Client changed their color!
                case 'l':
                    this.fake_latency = parseFloat(packet_parts[1]);break; // A client is asking for lag simulation
            }
        }
    }, {
        key: 'on_input_',
        value: function on_input_(socket_, parts_) {
            //The input commands come in like u-l,
            //so we split them up into separate commands,
            //and then update the avatars
            var input_commands = parts_[1].split('-'),
                input_time = parts_[2].replace('-', '.'),
                input_seq = parts_[3];

            //the client should be in a session, so
            //we can tell that session to handle the input
            if (socket_ && socket_.session) {
                socket_.session.handle_input(socket_, input_commands, input_time, input_seq);
            }
        }
    }, {
        key: 'find_session_',
        value: function find_session_(cl_socket_, cl_id_) {
            //Generate a new UUID, looks something like
            //5b2ca132-64bd-4513-99da-90e838ca47d1
            //and store this on their socket/connection
            cl_socket_.userid = cl_id_;

            //tell the avatar they connected, giving them their id
            cl_socket_.emit('onconnected', { id: cl_id_ });

            this.log_('looking for a session. We have : ' + this.session_count);
            //if there are any sessions at all, no sessions? create one!
            if (!this.session_count) {
                return this.create_session_(cl_socket_, cl_id_);
            }

            //so there are sessions active,
            //lets see if one needs another avatar
            var joined_a_session = false,
                found_session = null;
            //Check the list of sessions for an open session
            for (var session_id in this.sessions) // for all sessions
            {
                //only care about our own properties.
                if (!this.sessions.hasOwnProperty(session_id)) {
                    continue;
                }
                //get the session we are checking against
                found_session = this.sessions[session_id];
                //someone wants us to join!
                joined_a_session = found_session.try_to_start(cl_socket_, cl_id_) || joined_a_session;
            }

            //now if we didn't join a session,
            //we must create one
            if (!joined_a_session) {
                return this.create_session_(cl_socket_, cl_id_);
            }
            return found_session;
        }
    }, {
        key: 'create_session_',
        value: function create_session_(host_socket_, cl_id_) {
            //Create a new session instance, this actually runs the
            //session code like collisions and such.
            var session = new SvSession(host_socket_, cl_id_);

            //Store it in the list of session
            this.sessions[session.id] = session;
            //Keep track
            this.session_count++;
            //Start updating the session loop on the server
            session.update(new Date().getTime());

            host_socket_.session = session;

            console.log('server host at  ' + cm.get_owntime());
            this.log_('host ' + cl_id_ + ' created a session with id ' + host_socket_.session.id);
            //return it
            return session;
        }
    }, {
        key: 'destroy_session_',
        value: function destroy_session_(session_id_, userid_) {
            var session = this.sessions[session_id_];
            if (!session) {
                this.log_('that session was not found!');return;
            }

            //stop the session updates immediate
            var left_socket = session.stop(userid_);
            if (left_socket) {
                this.find_session_(left_socket);
            }

            delete this.sessions[session_id_];
            this.session_count--;
            this.log_('session removed. there are now ' + this.session_count + ' sessions');
        }
    }]);

    return SvPresenter;
})();

;

// on node.js
var server = new SvPresenter();
server.init_httpd();
server.init_socket();
//# sourceMappingURL=app.js.map
