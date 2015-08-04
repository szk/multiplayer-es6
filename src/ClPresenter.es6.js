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

