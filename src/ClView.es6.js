class ClView
{
    constructor(viewport_)
    {
        this.ctx = viewport_.getContext('2d');
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
        this.ctx.clearRect(0, 0, 720, 480);
        //draw help/information if required
        this.show_info_(avatars_);
        //Now they should have updated, we can draw the entity

        for (let avatar of avatars_)
        {
            this.show_avatar_(avatar);
        }
    }

    draw_debug(avatars_, ghosts_, dests_, naive_approach_, show_dest_pos_, show_sv_pos_)
    {
        if (!naive_approach_)
        {
            //and these
            if (show_dest_pos_) { this.show_avatar_(ghosts_[1]); }

            //and lastly draw these
            if (show_sv_pos_)
            {
                this.show_avatar_(ghosts_[0]);
                this.show_avatar_(ghosts_[1]);
            }
        }
    }

    show_avatar_(avatar_)
    {
        //Set the color for this avatar
        this.ctx.fillStyle = avatar_.color;
        //Draw a rectangle for us
        this.ctx.fillRect(avatar_.pos.x - avatar_.size.hx,
                           avatar_.pos.y - avatar_.size.hy,
                           avatar_.size.x, avatar_.size.y);
        //Draw a status update
        this.ctx.fillStyle = avatar_.info_color;
        this.ctx.fillText(avatar_.state, avatar_.pos.x + 10, avatar_.pos.y + 4);
    }

    show_info_(avatars_)
    {
        //We don't want this to be too distracting
        this.ctx.fillStyle = 'rgba(255,255,255,0.3)';

        //They can hide the help with the debug GUI
        if (this.show_help)
        {
            this.ctx.fillText('net_offset : local offset of others avatars and their server updates. Avatars are net_offset "in the past" so we can smoothly draw them interpolated.', 10, 30);
            this.ctx.fillText('sv_time : last known session time on server', 10, 70);
            this.ctx.fillText('cl_time : delayed session time on client for other avatars only (includes the net_offset)', 10, 90);
            this.ctx.fillText('net_latency : Time from you to the server. ', 10, 130);
            this.ctx.fillText('net_ping : Time from you to the server and back. ', 10, 150);
            this.ctx.fillText('fake_lag : Add fake ping/lag for testing, applies only to your inputs (watch sv_pos block!). ', 10, 170);
            this.ctx.fillText('cl_smoothing/cl_smooth : When updating avatars information from the server, it can smooth them out.', 10, 210);
            this.ctx.fillText(' This only applies to other clients when prediction is enabled, and applies to local avatar with no prediction.', 170, 230);
        }

        //Draw some information for the host
        if (avatars_[0].host)
        {
            this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
            this.ctx.fillText('You are the host', 10, 465);
        }

        //Reset the style back to full white.
        this.ctx.fillStyle = 'rgba(255,255,255,1)';
    }

    ////////////////// informations & debug
    create_debug_gui(cl_presenter_, avatars_)
    {
        let sock = cl_presenter_,
            sess = cl_presenter_.session;

        this.gui = new dat.GUI();

        let _avatarsettings = this.gui.addFolder('Your settings');

        this.colorcontrol = _avatarsettings.addColor(avatars_[0], 'color');

        //We want to know when we change our color so we can tell
        //the server to tell the other clients for us
        this.colorcontrol.onChange((value_) => { avatars_[0].color = value_;
                                                 localStorage.setItem('color', value_);
                                                 this.socket.send('c.' + value_);
                                               });
        _avatarsettings.open();

        let _othersettings = this.gui.addFolder('Methods');
        _othersettings.add(sock, 'naive_approach').listen();
        _othersettings.add(sess, 'cl_smoothing').listen();
        _othersettings.add(sess, 'cl_smooth').listen();
        _othersettings.add(sock, 'cl_predict').listen();

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
        _netsettings.add(sock, 'sv_time').step(0.001).listen();
        _netsettings.add(sock, 'cl_time').step(0.001).listen();
        _netsettings.add(sock, 'oldest_tick').step(0.001).listen();

        _netsettings.open();
    }
};
