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
