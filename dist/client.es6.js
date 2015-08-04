'use strict';
// (4.22208334636).fixed(n) will return fixed point value to n places, default n = 3
Number.prototype.fixed = function(n_) { n_ = n_ || 3; return parseFloat(this.toFixed(n_)); };

class Common
{
    constructor()
    {
        //The speed at which the clients move.
        this.avatarspeed = 120;
        this.owntime_ = 0.016;
        this.world = { width: 720, height: 480 };
    }

    /*
     Shared between server and client.
     In this example, `item` is always of type avatar.
     */
    check_collision(item_)
    {
        if (item_.pos.x < item_.pos_limits.x_min || item_.pos.x > item_.pos_limits.x_max)
        {
            item_.pos.x = Math.min(Math.max(item_.pos.x, item_.pos_limits.x_min),
                                   item_.pos_limits.x_max);
        }
        if (item_.pos.y < item_.pos_limits.y_min || item_.pos.y > item_.pos_limits.y_max)
        {
            item_.pos.y = Math.min(Math.max(item_.pos.y, item_.pos_limits.y_min),
                                   item_.pos_limits.y_max);
        }
        //Fixed point helps be more deterministic
        item_.pos.x = item_.pos.x.fixed(4);
        item_.pos.y = item_.pos.y.fixed(4);
    }

    process_input(avatar_)
    {
        //It's possible to have recieved multiple inputs by now,
        //so we process each one
        let x_dir = 0;
        let y_dir = 0;
        let ic = avatar_.inputs.length;
        if (ic) //if we have inputs
        {
            for (let j = 0; j < ic; ++j) //for each input command
            {
                //don't process ones we already have simulated locally
                if (avatar_.inputs[j].seq <= avatar_.last_input_seq) { continue; }

                let input = avatar_.inputs[j].inputs;
                let c = input.length;
                for (let i = 0; i < c; ++i) //for all input values
                {
                    let key = input[i];
                    if (key == 'l') { x_dir -= 1; }
                    if (key == 'r') { x_dir += 1; }
                    if (key == 'd') { y_dir += 1; }
                    if (key == 'u') { y_dir -= 1; }
                }
            }
        }

        //we have a direction vector now, so apply the same physics as the client
        let resulting_vector = this.physics_movement_vector_from_direction(x_dir, y_dir);
        if (avatar_.inputs.length)
        {
            //we can now clear the array since these have been processed
            avatar_.last_input_time = avatar_.inputs[ic - 1].time;
            avatar_.last_input_seq = avatar_.inputs[ic - 1].seq;
        }

        //give it back
        return resulting_vector;
    }

    physics_movement_vector_from_direction(x_, y_)
    {
        //Must be fixed step, at physics sync speed.
        return { x: (x_ * (this.avatarspeed * 0.015)).fixed(3),
                 y: (y_ * (this.avatarspeed * 0.015)).fixed(3) };
    }

    start_physics_loop(component_)
    {
        //Set up some physics integration values
        this._pdt = 0.0001; //The physics update delta time
        this._pdte = new Date().getTime(); //The physics update last delta time
        //A local timer for precision on server and client
        this.owntime_ = 0.016; //The local timer
        this._dt = new Date().getTime(); //The local timer delta
        this._dte = new Date().getTime(); //The local timer last frame time

        //Start a physics loop, this is separate to the rendering
        //as this happens at a fixed frequency
        setInterval(() => { this._pdt = (new Date().getTime() - this._pdte) / 1000.0;
                            this._pdte = new Date().getTime();
                            component_.update_physics(this._pdt); },
                    15);

        //Start a fast paced timer for measuring time easier
        setInterval(() => { this._dt = new Date().getTime() - this._dte;
                            this._dte = new Date().getTime();
                            this.set_owntime(this.owntime_ + this._dt / 1000.0); },
                    4);
    }

    set_owntime(v_) { if (v_) { this.owntime_ = v_;} }
    get_owntime() { return this.owntime_; }

    /*
     Helper functions for the session code

     Here we have some common maths and session related code to make working with 2d vectors easy,
     as well as some helpers for rounding numbers to fixed point.
     */
    //copies a 2d vector like object from one to another
    new_pos(a_) { return { x: a_.x, y: a_.y }; }
    //Add a 2d vector with another one and return the resulting vector
    v_add(a_, b_) { return { x: (a_.x + b_.x).fixed(), y: (a_.y + b_.y).fixed() }; }
    //Subtract a 2d vector with another one and return the resulting vector
    v_sub(a_, b_) { return { x: (a_.x - b_.x).fixed(), y: (a_.y - b_.y).fixed() }; }
    //Multiply a 2d vector with a scalar value and return the resulting vector
    v_mul_scalar(a_, b_) { return { x: (a_.x * b_).fixed(), y: (a_.y * b_).fixed() }; }
    //Simple linear interpolation
    lerp(p_, n_, t_) { let t = Number(t_); t = Math.max(0, Math.min(1, t)).fixed(); return (p_ + t * (n_ - p_)).fixed(); }
    //Simple linear interpolation between 2 vectors
    v_lerp(v_, tv_, t_) { return { x: this.lerp(v_.x, tv_.x, t_), y: this.lerp(v_.y, tv_.y, t_) }; }
};

let cm = new Common();

class ClView
{
    constructor(viewport_)
    {
        this.ctx_ = viewport_.getContext('2d');
        //Create a keyboard handler
        this.keyboard = new THREEx.KeyboardState();
        this.input_queue = [];
    }

    handle_input()
    {
        //if(this.lit > local_time) return;
        //this.lit = local_time+0.5; //one second delay

        //This takes input from the client and keeps a record,
        //It also sends the input information to the server immediately
        //as it is pressed. It also tags each input with a sequence number.
        let x_dir = 0,
            y_dir = 0;
        this.input_queue = [];

        if (this.keyboard.pressed('A') || this.keyboard.pressed('left')) //left
        { x_dir = -1; this.input_queue.push('l'); }
        if (this.keyboard.pressed('D') || this.keyboard.pressed('right')) //right
        { x_dir = 1; this.input_queue.push('r'); }
        if (this.keyboard.pressed('S') || this.keyboard.pressed('down')) //down
        { y_dir = 1; this.input_queue.push('d'); }
        if (this.keyboard.pressed('W') || this.keyboard.pressed('up')) //up
        { y_dir = -1; this.input_queue.push('u'); }

        return this.input_queue;

        // if (!this.input_queue.length) { return { x: 0, y: 0 }; }

        // //Return the direction if needed
        // return cm.physics_movement_vector_from_direction(x_dir, y_dir);
    }

    draw(avatars_)
    {
        //Clear the screen area
        this.ctx_.clearRect(0, 0, 720, 480);
        //draw help/information if required
        this.show_info_(avatars_);
        //Now they should have updated, we can draw the entity
        this.show_avatar_(avatars_.other);
        //And then we finally draw
        this.show_avatar_(avatars_.self);
    }

    draw_debug(avatars_, ghosts_, naive_approach_, show_dest_pos_, show_sv_pos_)
    {
        if (!naive_approach_)
        {
            //and these
            if (show_dest_pos_) { this.show_avatar_(ghosts_.pos_other); }

            //and lastly draw these
            if (show_sv_pos_)
            {
                this.show_avatar_(ghosts_.sv_pos_self);
                this.show_avatar_(ghosts_.sv_pos_other);
            }
        }
    }

    show_avatar_(avatar_)
    {
        //Set the color for this avatar
        this.ctx_.fillStyle = avatar_.color;
        //Draw a rectangle for us
        this.ctx_.fillRect(avatar_.pos.x - avatar_.size.hx,
                           avatar_.pos.y - avatar_.size.hy,
                           avatar_.size.x, avatar_.size.y);
        //Draw a status update
        this.ctx_.fillStyle = avatar_.info_color;
        this.ctx_.fillText(avatar_.state, avatar_.pos.x + 10, avatar_.pos.y + 4);
    }

    show_info_(avatars_)
    {
        //We don't want this to be too distracting
        this.ctx_.fillStyle = 'rgba(255,255,255,0.3)';

        //They can hide the help with the debug GUI
        if (this.show_help)
        {
            this.ctx_.fillText('net_offset : local offset of others avatars and their server updates. Avatars are net_offset "in the past" so we can smoothly draw them interpolated.', 10, 30);
            this.ctx_.fillText('server_time : last known session time on server', 10, 70);
            this.ctx_.fillText('client_time : delayed session time on client for other avatars only (includes the net_offset)', 10, 90);
            this.ctx_.fillText('net_latency : Time from you to the server. ', 10, 130);
            this.ctx_.fillText('net_ping : Time from you to the server and back. ', 10, 150);
            this.ctx_.fillText('fake_lag : Add fake ping/lag for testing, applies only to your inputs (watch sv_pos block!). ', 10, 170);
            this.ctx_.fillText('client_smoothing/client_smooth : When updating avatars information from the server, it can smooth them out.', 10, 210);
            this.ctx_.fillText(' This only applies to other clients when prediction is enabled, and applies to local avatar with no prediction.', 170, 230);
        }

        //Draw some information for the host
        if (avatars_.self.host)
        {
            this.ctx_.fillStyle = 'rgba(255,255,255,0.7)';
            this.ctx_.fillText('You are the host', 10, 465);
        }

        //Reset the style back to full white.
        this.ctx_.fillStyle = 'rgba(255,255,255,1)';
    }

    ////////////////// informations & debug
    create_debug_gui(cl_presenter_, avatars_)
    {
        let sock = cl_presenter_,
            sess = cl_presenter_.session;

        this.gui = new dat.GUI();

        let _avatarsettings = this.gui.addFolder('Your settings');

        this.colorcontrol = _avatarsettings.addColor(avatars_.self, 'color');

        //We want to know when we change our color so we can tell
        //the server to tell the other clients for us
        this.colorcontrol.onChange((value_) => { avatars_.self.color = value_;
                                                 localStorage.setItem('color', value_);
                                                 this.socket.send('c.' + value_);
                                               });
        _avatarsettings.open();

        let _othersettings = this.gui.addFolder('Methods');
        _othersettings.add(sock, 'naive_approach').listen();
        _othersettings.add(sess, 'client_smoothing').listen();
        _othersettings.add(sess, 'client_smooth').listen();
        _othersettings.add(sock, 'client_predict').listen();

        let _debugsettings = this.gui.addFolder('Debug view');
        _debugsettings.add(sess, 'show_help').listen();
        _debugsettings.add(sess, 'fps_avg').listen();
        _debugsettings.add(sock, 'show_sv_pos').listen();
        _debugsettings.add(sock, 'show_dest_pos').listen();
        _debugsettings.add(cm, 'owntime_').listen();

        _debugsettings.open();

        let _consettings = this.gui.addFolder('Connection');
        _consettings.add(sess, 'net_latency').step(0.001).listen();
        _consettings.add(sess, 'net_ping').step(0.001).listen();

        //When adding fake lag, we need to tell the server about it.
        let lag_control = _consettings.add(sock, 'fake_lag').step(0.001).listen();
        lag_control.onChange((value) => { this.socket.send('l.' + value); });

        _consettings.open();

        let _netsettings = this.gui.addFolder('Networking');
        _netsettings.add(sock, 'net_offset').min(0.01).step(0.001).listen();
        _netsettings.add(sock, 'server_time').step(0.001).listen();
        _netsettings.add(sock, 'client_time').step(0.001).listen();
        _netsettings.add(sock, 'oldest_tick').step(0.001).listen();

        _netsettings.open();
    }
};

class ClSession
{
    constructor(socket_, avatars_, ghosts_)
    {
        this.socket = socket_;
        this.avatars = avatars_;
        this.ghosts = ghosts_;

        this.show_help = false; //Whether or not to draw the help text

        this.client_smoothing = true; //Whether or not the client side prediction tries to smooth things out
        this.client_smooth = 25; //amount of smoothing to apply to client update dest

        this.net_latency = 0.001; //the latency between the client and the server (ping/2)
        this.net_ping = 0.001; //The round trip time from here to the server,and back

        this.target_time = 0.01; //the time where we want to be in the server timeline
        this.lastframetime = 0;
        this.dt = 0.016; //The time that the last frame took to run

        this.fps = 0; //The current instantaneous fps (1/this.dt)
        this.fps_avg_count = 0; //The number of samples we have taken for fps_avg
        this.fps_avg = 0; //The current average fps displayed in the debug UI
        this.fps_avg_acc = 0; //The accumulation of the last avgcount fps samples

        this.lit = 0;
        this.llt = new Date().getTime();
    }

    on_ready_session(data_)
    {
        let server_time = parseFloat(data_.replace('-', '.'));

        let socket_host = this.avatars.self.host ? this.avatars.self : this.avatars.other;
        let socket_client = this.avatars.self.host ? this.avatars.other : this.avatars.self;

        cm.set_owntime(server_time + this.net_latency);
        console.log('server time is about ' + cm.get_owntime());

        //Store their info colors for clarity. server is always blue
        socket_host.info_color = '#2288cc';
        socket_client.info_color = '#cc8822';

        //Update their information
        socket_host.state = 'local_pos(hosting)';
        socket_client.state = 'local_pos(joined)';

        this.avatars.self.state = 'YOU ' + this.avatars.self.state;

        //Make sure colors are synced up
        this.socket.send('c.' + this.avatars.self.color);
    }

    on_join_session(data_)
    {
        //We are not the host
        this.avatars.self.host = false;
        //Update the local state
        this.avatars.self.state = 'connected.joined.waiting';
        this.avatars.self.info_color = '#00bb00';

        //Make sure the positions match servers and other clients
        this.reset_positions_();
    }

    on_host_session(data_)
    {
        //The server sends the time when asking us to host, but it should be a new session.
        //so the value will be really small anyway (15 or 16ms)
        let server_time = parseFloat(data_.replace('-', '.'));

        //Get an estimate of the current time on the server
        cm.set_owntime(server_time + this.net_latency);

        //Set the flag that we are hosting, this helps us position respawns correctly
        this.avatars.self.host = true;

        //Update debugging information to display state
        this.avatars.self.state = 'hosting.waiting for a avatar';
        this.avatars.self.info_color = '#cc0000';

        //Make sure we start in the correct place as the host.
        this.reset_positions_();
    }

    on_otherclientcolorchange(data_)
    {
        this.avatars.other.color = data_;
    }

    on_ping(data_)
    {
        this.net_ping = new Date().getTime() - parseFloat(data_);
        this.net_latency = this.net_ping / 2;
    }

    reset_positions_()
    {
        let socket_host = this.avatars.self.host ? this.avatars.self : this.avatars.other;
        let socket_client = this.avatars.self.host ? this.avatars.other : this.avatars.self;

        //Host always spawns at the top left.
        socket_host.pos = { x: 20, y: 20 };
        socket_client.pos = { x: 500, y: 200 };

        //Make sure the local avatar physics is updated
        this.avatars.self.old_state.pos = cm.new_pos(this.avatars.self.pos);
        this.avatars.self.pos = cm.new_pos(this.avatars.self.pos);
        this.avatars.self.cur_state.pos = cm.new_pos(this.avatars.self.pos);

        //Position all debug view items to their owners position
        this.ghosts.sv_pos_self.pos = cm.new_pos(this.avatars.self.pos);
        this.ghosts.sv_pos_other.pos = cm.new_pos(this.avatars.other.pos);
        this.ghosts.pos_other.pos = cm.new_pos(this.avatars.other.pos);
    }

    update(t_, server_updates_, client_predict_, naive_approach_, pdt_, client_time_, tx_packet_)
    {
        //Capture inputs from the avatar
        this.socket.send(tx_packet_);

        //Work out the delta time
        this.dt = this.lastframetime ? ((t_ - this.lastframetime) / 1000.0).fixed() : 0.016;
        //Store the last frame time
        this.lastframetime = t_;

        //Network avatar just gets drawn normally, with interpolation from
        //the server updates, smoothing out the positions from the past.
        //Note that if we don't have prediction enabled - this will also
        //update the actual local client position on screen as well.
        if (!naive_approach_)
        {
            this.process_net_updates_(server_updates_, client_predict_, naive_approach_,
                                      pdt_, client_time_);
        }

        //When we are doing client side prediction, we smooth out our position
        //across frames using local input states we have stored.
        this.update_local_position(client_predict_, pdt_);

        //Work out the fps average
        this.refresh_fps_();
    }

    process_net_updates_(server_updates_, client_predict_, naive_approach_, pdt_, client_time_)
    {
        //No updates...
        if (!server_updates_.length) { return; }

        //First : Find the position in the updates, on the timeline
        //We call this current_time, then we find the past_pos and the target_pos using this,
        //searching throught the server_updates array for current_time in between 2 other times.
        // Then :  other avatar position = lerp ( past_pos, target_pos, current_time );

        //Find the position in the timeline of updates we stored.
        let current_time = client_time_;
        let count = server_updates_.length - 1;
        let target = null;
        let previous = null;

        //We look from the 'oldest' updates, since the newest ones
        //are at the end (list.length-1 for example). This will be expensive
        //only when our time is not found on the timeline, since it will run all
        //samples. Usually this iterates very little before breaking out with a target.
        for (let i = 0; i < count; ++i)
        {
            let point = server_updates_[i];
            let next_point = server_updates_[i + 1];

            //Compare our point in time with the server times we have
            if (current_time > point.t && current_time < next_point.t)
            {
                target = next_point;
                previous = point;
                break;
            }
        }

        //With no target we store the last known
        //server position and move to that instead
        if (!target)
        {
            target = server_updates_[0];
            previous = server_updates_[0];
        }

        //Now that we have a target and a previous destination,
        //We can interpolate between then based on 'how far in between' we are.
        //This is simple percentage maths, value/target = [0,1] range of numbers.
        //lerp requires the 0,1 value to lerp to? thats the one.
        if (!target || !previous) { return; }

        this.target_time = target.t;

        let difference = this.target_time - current_time;
        let max_difference = (target.t - previous.t).fixed(3);
        let time_point = (difference / max_difference).fixed(3);

        //Because we use the same target and previous in extreme cases
        //It is possible to get incorrect values due to division by 0 difference
        //and such. This is a safe guard and should probably not be here. lol.
        if (isNaN(time_point) || time_point == -Infinity || time_point == Infinity) { time_point = 0; }

        //The most recent server update
        let latest_server_data = server_updates_[server_updates_.length - 1];

        //These are the exact server positions from this tick, but only for the ghost
        let other_sv_pos = this.avatars.self.host ? latest_server_data.cp : latest_server_data.hp;

        //The other avatars positions in this timeline, behind us and in front of us
        let other_target_pos = this.avatars.self.host ? target.cp : target.hp;
        let other_past_pos = this.avatars.self.host ? previous.cp : previous.hp;

        //update the dest block, this is a simple lerp
        //to the target from the previous point in the server_updates buffer
        this.ghosts.sv_pos_other.pos = cm.new_pos(other_sv_pos);
        this.ghosts.pos_other.pos = cm.v_lerp(other_past_pos, other_target_pos, time_point);

        this.avatars.other.pos = this.update_pos_(this.avatars.other, this.ghosts.pos_other.pos, pdt_);

        //Now, if not predicting client movement , we will maintain the local avatar position
        //using the same method, smoothing the avatars information from the past.
        if (!client_predict_ && !naive_approach_)
        {
            //These are the exact server positions from this tick, but only for the ghost
            let my_sv_pos = this.avatars.self.host ? latest_server_data.hp : latest_server_data.cp;

            //The other avatars positions in this timeline, behind us and in front of us
            let my_target_pos = this.avatars.self.host ? target.hp : target.cp;
            let my_past_pos = this.avatars.self.host ? previous.hp : previous.cp;

            //Snap the ghost to the new server position
            this.ghosts.sv_pos_self.pos = cm.new_pos(my_sv_pos);
            let local_target = cm.v_lerp(my_past_pos, my_target_pos, time_point);

            // Smoothly follow the destination position
            this.avatars.self.pos = this.update_pos_(this.avatars.self, local_target, pdt_);
        }
    }

    update_pos_(item_, target_pos_, pdt_)
    {
        if (this.client_smoothing) { return cm.v_lerp(item_.pos, target_pos_, pdt_ * this.client_smooth); }
        return cm.new_pos(target_pos_);
    }

    update_local_position(client_predict_, pdt_)
    {
        if (!client_predict_) { return; }

        //Work out the time we have since we updated the state
        let t = (cm.get_owntime() - this.avatars.self.state_time) / pdt_;

        //Then store the states for clarity,
        let old_state = this.avatars.self.old_state.pos;
        let current_state = this.avatars.self.cur_state.pos;

        //Make sure the visual position matches the states we have stored
        // this.avatars.self.pos = cm.v_add(old_state,
        //                                  cm.v_mul_scalar(cm.v_sub(current_state,
        //                                                           old_state), t ));
        this.avatars.self.pos = current_state;

        //We handle collision on client if predicting.
        cm.check_collision(this.avatars.self);
    }

    refresh_fps_()
    {
        //We store the fps for 10 frames, by adding it to this accumulator
        this.fps = 1 / this.dt;
        this.fps_avg_acc += this.fps;
        this.fps_avg_count++;

        //When we reach 10 frames we work out the average fps
        if (this.fps_avg_count >= 10)
        {
            this.fps_avg = this.fps_avg_acc / 10;
            this.fps_avg_count = 1;
            this.fps_avg_acc = this.fps;
        }
    }
};

class ClPresenter
{
    constructor()
    {
    }

    init(viewport_)
    {
        this.viewport_ = viewport_;
        this.viewport_.width = cm.world.width;
        this.viewport_.height = cm.world.height;
        this.view = new ClView(this.viewport_);

        this.input_seq = 0;  //When predicting client inputs, we store the last input as a sequence number

        //Create the default configuration settings
        this.naive_approach = false; //Whether or not to use the naive approach
        this.client_predict = true; //Whether or not the client is predicting input
        this.show_sv_pos = false; //Whether or not to show the server position
        this.show_dest_pos = false; //Whether or not to show the interpolation goal

        this.last_ping_time = 0.001; //The time we last sent a ping
        this.fake_lag = 0; //If we are simulating lag, this applies only to the input client (not others)
        this.fake_lag_time = 0;

        this.net_offset = 100; //100 ms latency between server and client interpolation for other clients
        this.buffer_size = 2; //The size of the server history to keep for rewinding/interpolating.
        this.oldest_tick = 0.01; //the last time tick we have available in the buffer
        this.client_time = 0.01; //Our local 'clock' based on server time - client interpolation(net_offset).
        this.server_time = 0.01; //The time the server reported it was at, last we heard from it

        this.pdt = 0.0001; // for smoothing (check ClSession)

        this.session = null;

        // wait for resources
        this.load_model_();
    }

    start_(models_)
    {
        this.avatars = models_[0];
        this.ghosts = models_[1];
        //A list of recent server updates we interpolate across
        //This is the buffer that is the driving factor for our networking
        this.server_updates = [];

        //Connect to the socket.io server!
        this.connect_to_server_();

        //We start pinging the server to determine latency
        this.create_ping_timer_();

        //Set their colors from the storage or locally
        this.color = localStorage.getItem('color') || '#cc8822';
        localStorage.setItem('color', this.color);
        this.avatars.self.color = this.color;

        //Make this only if requested
        if (String(window.location).indexOf('debug') != -1)
        { this.view.create_debug_gui(this, this.avatars); }
        cm.start_physics_loop(this);

        // Start the loop
        this.update_(new Date().getTime());
    }

    //Main update loop
    update_(t_)
    {
        let input_q = this.view.handle_input();
        this.input_seq += 1; //Update what sequence we are on now

        //Store the input state as a snapshot of what happened.
        this.avatars.self.inputs.push({ inputs: input_q,
                                        time: cm.get_owntime().fixed(3),
                                        seq: this.input_seq });

        //Update the session specifics
        if (this.session)
        {
            //Send the packet of information to the server.
            //The input packets are labelled with an 'i' in front.
            let tx_packet = 'i.' + input_q.join('-')
                    + '.' + cm.get_owntime().toFixed(3).replace('.', '-')
                    + '.' + this.input_seq;
            this.session.update(t_, this.server_updates, this.client_predict, this.naive_approach,
                                this.pdt, this.client_time, tx_packet);
        }

        // drawing job
        this.view.draw(this.avatars);
        this.view.draw_debug(this.avatars, this.ghosts, this.naive_approach,
                             this.show_dest_pos, this.show_sv_pos);

        //schedule the next update
        this.updateid = window.requestAnimationFrame(this.update_.bind(this), this.viewport_);
    }

    stop_update() { window.cancelAnimationFrame(this.updateid); }

    load_model_()
    {
        let req = new XMLHttpRequest();

        req.addEventListener('loadend', () => {
            if (req.status === 200)
            {
                let models = [{ self: this.gen_model_(req.response),
                                other: this.gen_model_(req.response) },
                              { sv_pos_self: this.gen_model_(req.response), //Our ghost position on the server
                                sv_pos_other: this.gen_model_(req.response), //The other avatars server position as we receive it
                                pos_other: this.gen_model_(req.response) }]; //The other avatars ghost destination position (the lerp)]
                models[1].sv_pos_self.state = 'sv_pos';
                models[1].sv_pos_self.info_color = 'rgba(255,255,255,0.2)';
                models[1].sv_pos_self.pos = { x: 20, y: 20 };

                models[1].sv_pos_other.state = 'sv_pos';
                models[1].sv_pos_other.info_color = 'rgba(255,255,255,0.2)';
                models[1].sv_pos_other.pos = { x: 500, y: 200 };

                models[1].pos_other.state = 'dest_pos';
                models[1].pos_other.info_color = 'rgba(255,255,255,0.1)';
                models[1].pos_other.pos = { x: 500, y: 200 };

                this.start_(models);
            }
            else { console.error(req.status + ' ' + req.statusText); }
        });
        req.open('GET', '/model', true);
        req.responseType = 'json';
        req.timeout = 4000;
        req.ontimeout = (() => { alert("timed out"); });
        req.send();
    }

    gen_model_(json_) { return Object.assign({}, JSON.parse(json_)); }

    process_net_prediction_correction_()
    {
        //No updates...
        if (!this.server_updates.length) { return; }

        //The most recent server update
        let latest_server_data = this.server_updates[this.server_updates.length - 1];

        //Our latest server position
        let my_sv_pos = this.avatars.self.host ? latest_server_data.hp : latest_server_data.cp;

        //Update the debug server position block
        this.ghosts.sv_pos_self.pos = cm.new_pos(my_sv_pos);

        //here we handle our local input prediction ,
        //by correcting it with the server and reconciling its differences

        let my_last_input_on_server = this.avatars.self.host ? latest_server_data.his : latest_server_data.cis;
        if (!my_last_input_on_server) { return; }

        //The last input sequence index in my local input list
        let lastinputseq_index = -1;
        //Find this input in the list, and store the index
        for (let i = 0; i < this.avatars.self.inputs.length; ++i)
        {
            if (this.avatars.self.inputs[i].seq == my_last_input_on_server)
            { lastinputseq_index = i; break; }
        }

        //Now we can crop the list of any updates we have already processed
        if (lastinputseq_index == -1) { return; }

        //so we have now gotten an acknowledgement from the server that our inputs here have been accepted
        //and that we can predict from this known position instead

        //remove the rest of the inputs we have confirmed on the server
        let number_to_clear = Math.abs(lastinputseq_index - (-1));
        this.avatars.self.inputs.splice(0, number_to_clear);
        //The avatar is now located at the new server position, authoritive server
        this.avatars.self.cur_state.pos = cm.new_pos(my_sv_pos);
        this.avatars.self.last_input_seq = lastinputseq_index;

        //Now we reapply all the inputs that we have locally that
        //the server hasn't yet confirmed. This will 'keep' our position the same,
        //but also confirm the server position at the same time.
        this.update_physics(this.pdt);
        this.session.update_local_position(this.client_predict, this.pdt);
    }

    update_physics(pdt_)
    {
        this.pdt = pdt_;
        //Fetch the new direction from the input buffer,
        //and apply it to the state so we can smooth it in the visual state

        if (!this.client_predict) { return; }

        this.avatars.self.old_state.pos = cm.new_pos(this.avatars.self.cur_state.pos);
        this.avatars.self.cur_state.pos = cm.v_add(this.avatars.self.old_state.pos,
                                                   cm.process_input(this.avatars.self));
        this.avatars.self.state_time = cm.get_owntime();
    }

    create_ping_timer_()
    {
        //Set a ping timer to 1 second, to maintain the ping/latency between
        //client and server and calculated roughly how our connection is doing
        setInterval(() => { this.last_ping_time = new Date().getTime() - this.fake_lag;
                            this.socket.send('p.' + this.last_ping_time); },
                    1000);
    }

    // callbacks
    on_disconnect_(data_)
    {
        //When we disconnect, we don't know if the other avatar is
        //connected or not, and since we aren't, everything goes to offline
        this.avatars.self.info_color = 'rgba(255,255,255,0.1)';
        this.avatars.self.state = 'not-connected';
        this.avatars.self.online = false;

        this.avatars.other.info_color = 'rgba(255,255,255,0.1)';
        this.avatars.other.state = 'not-connected';
    }

    on_serverupdate_recieved_(data_)
    {
        //Lets clarify the information we have locally. One of the avatars is 'hosting' and
        //the other is a joined in client, so we name these host and client for making sure
        //the positions we get from the server are mapped onto the correct local sprites
        let socket_host = this.avatars.self.host ? this.avatars.self : this.avatars.other;
        let socket_client = this.avatars.self.host ? this.avatars.other : this.avatars.self;
        let this_avatar = this.avatars.self;

        //Store the server time (this is offset by the latency in the network, by the time we get it)
        this.server_time = data_.t;
        //Update our local offset time from the last server update
        this.client_time = this.server_time - this.net_offset / 1000;

        //One approach is to set the position directly as the server tells you.
        //This is a common mistake and causes somewhat playable results on a local LAN, for example,
        //but causes terrible lag when any ping/latency is introduced. The avatar can not deduce any
        //information to interpolate with so it misses positions, and packet loss destroys this approach
        //even more so. See 'the bouncing ball problem' on Wikipedia.
        if (this.naive_approach)
        {
            if (data_.hp) { socket_host.pos = cm.new_pos(data_.hp); }
            if (data_.cp) { socket_client.pos = cm.new_pos(data_.cp); }
            return;
        }

        //Cache the data from the server,
        //and then play the timeline
        //back to the avatar with a small delay (net_offset), allowing
        //interpolation between the points.
        this.server_updates.push(data_);

        //we limit the buffer in seconds worth of updates
        //60fps*buffer seconds = number of samples
        if (this.server_updates.length >= 60 * this.buffer_size)
        { this.server_updates.splice(0, 1); }

        //We can see when the last tick we know of happened.
        //If client_time gets behind this due to latency, a snap occurs
        //to the last tick. Unavoidable, and a reallly bad connection here.
        //If that happens it might be best to drop the session after a period of time.
        this.oldest_tick = this.server_updates[0].t;

        //Handle the latest positions from the server
        //and make sure to correct our local predictions, making the server have final say.
        this.process_net_prediction_correction_();
    }

    on_connected_(data_)
    {
        //The server responded that we are now in a session,
        //this lets us store the information about ourselves and set the colors
        //to show we are now ready to be playing.
        this.avatars.self.id = data_.id;
        this.avatars.self.info_color = '#cc0000';
        this.avatars.self.state = 'connected';
        this.avatars.self.online = true;
    }

    on_netmessage_(data_)
    {
        let commands = data_.split('.');
        let command = commands[0];
        let subcommand = commands[1] || null;
        let commanddata = commands[2] || null;

        switch (command) {
        case 's':
            //server message
            switch (subcommand) {
            case 'h': //host a session requested
                this.session.on_host_session(commanddata); break;
            case 'j': //join a session requested
                this.session.on_join_session(commanddata); break;
            case 'r': //ready a session requested
                this.session.on_ready_session(commanddata); break;
            case 'e': //end session requested
                this.on_disconnect_(commanddata); break;
            case 'p': //server ping
                this.session.on_ping(commanddata); break;
            case 'c': //other avatar changed colors
                this.session.on_otherclientcolorchange(commanddata); break;
            } //subcommand
            break; //'s'
        } //command
    }

    connect_to_server_()
    {
        //Store a local reference to our connection to the server
        this.socket = io.connect();

        //When we connect, we are not 'connected' until we have a server id
        //and are placed in a session by the server. The server sends us a message for that.
        this.socket.on('connect', () => { this.avatars.self.state = 'connecting'; });

        this.session = new ClSession(this.socket, this.avatars, this.ghosts);

        //Sent when we are disconnected (network, server down, etc)
        this.socket.on('disconnect', this.on_disconnect_.bind(this));
        //Sent each tick of the server simulation. This is our authoritive update
        this.socket.on('onserverupdate', this.on_serverupdate_recieved_.bind(this));
        //Handle when we connect to the server, showing state and storing id's.
        this.socket.on('onconnected', this.on_connected_.bind(this));
        //On error we just show that we are not connected for now. Can print the data.
        this.socket.on('error', this.on_disconnect_.bind(this));
        //On message from the server, we parse the commands and send it to the handlers
        this.socket.on('message', this.on_netmessage_.bind(this));
    }
}

// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
// http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating

// requestAnimationFrame polyfill by Erik Möller
// fixes from Paul Irish and Tino Zijdel

window.onload = function () {
    let frame_time = 60 / 1000; // run the local session at 16ms/ 60hz
    let cl_last_time = 0;
    let vendors = ['ms', 'moz', 'webkit', 'o'];

    for (let x = 0; x < vendors.length && !window.requestAnimationFrame; ++x)
    {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame']
            || window[vendors[x] + 'CancelRequestAnimationFrame'];
    }

    if (!window.requestAnimationFrame)
    {
        window.requestAnimationFrame = ((cb_, el_) => {
            let currTime = Date.now(),
                timeToCall = Math.max(0, frame_time - (currTime - cl_last_time));
            let id = window.setTimeout(() => { cb_(currTime + timeToCall); }, timeToCall);
            cl_last_time = currTime + timeToCall;
            return id;
        });
    }

    if (!window.cancelAnimationFrame)
    { window.cancelAnimationFrame = ((id) => { clearTimeout(id); }); }

    // Create our client instance.
    let client = new ClPresenter();
    client.init(document.getElementById('viewport'));
};

