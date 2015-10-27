class ClSession
{
    constructor(socket_, avatars_, ghosts_, dests_)
    {
        this.socket = socket_;
        this.avatars = avatars_;
        this.ghosts = ghosts_;
        this.dests = dests_;

        this.show_help = false; //Whether or not to draw the help text

        this.cl_smoothing = true; //Whether or not the client side prediction tries to smooth things out
        this.cl_smooth = 25; //amount of smoothing to apply to client update dest

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
        let sv_time = parseFloat(data_.replace('-', '.'));

        let socket_host = this.avatars[0].host ? this.avatars[0] : this.avatars[1];
        let socket_client = this.avatars[0].host ? this.avatars[1] : this.avatars[0];

        cm.set_owntime(sv_time + this.net_latency);
        console.log('server time is about ' + cm.get_owntime());

        //Store their info colors for clarity. server is always blue
        socket_host.info_color = '#2288cc';
        socket_client.info_color = '#cc8822';

        //Update their information
        socket_host.state = 'local_pos(hosting)';
        socket_client.state = 'local_pos(joined)';

        this.avatars[0].state = 'YOU ' + this.avatars[0].state;

        //Make sure colors are synced up
        this.socket.send('c.' + this.avatars[0].color);
    }

    on_join_session(data_)
    {
        //We are not the host
        this.avatars[0].host = false;
        //Update the local state
        this.avatars[0].state = 'connected.joined.waiting';
        this.avatars[0].info_color = '#00bb00';

        //Make sure the positions match servers and other clients
        this.reset_positions_();
    }

    on_host_session(data_)
    {
        //The server sends the time when asking us to host, but it should be a new session.
        //so the value will be really small anyway (15 or 16ms)
        let sv_time = parseFloat(data_.replace('-', '.'));

        //Get an estimate of the current time on the server
        cm.set_owntime(sv_time + this.net_latency);

        //Set the flag that we are hosting, this helps us position respawns correctly
        this.avatars[0].host = true;

        //Update debugging information to display state
        this.avatars[0].state = 'hosting.waiting for a avatar';
        this.avatars[0].info_color = '#cc0000';

        //Make sure we start in the correct place as the host.
        this.reset_positions_();
    }

    on_otherclientcolorchange(data_)
    {
        this.avatars[1].color = data_;
    }

    on_ping(data_)
    {
        this.net_ping = new Date().getTime() - parseFloat(data_);
        this.net_latency = this.net_ping / 2;
    }

    reset_positions_()
    {
        let socket_host = this.avatars[0].host ? this.avatars[0] : this.avatars[1],
            socket_client = this.avatars[0].host ? this.avatars[1] : this.avatars[0];

        //Host always spawns at the top left.
        socket_host.pos = { x: 20, y: 20 };
        socket_client.pos = { x: 500, y: 200 };

        //Make sure the local avatar physics is updated
        this.avatars[0].old_state.pos = cm.new_pos(this.avatars[0].pos);
        this.avatars[0].pos = cm.new_pos(this.avatars[0].pos);
        this.avatars[0].cur_state.pos = cm.new_pos(this.avatars[0].pos);

        //Position all debug view items to their owners position
        this.ghosts[0].pos = cm.new_pos(this.avatars[0].pos);
        this.ghosts[1].pos = cm.new_pos(this.avatars[1].pos);
        this.dests[1].pos = cm.new_pos(this.avatars[1].pos);
    }

    update(t_, sv_updates_, cl_predict_, naive_approach_, pdt_, cl_time_, tx_packet_)
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
            this.process_net_updates_(sv_updates_, cl_predict_, naive_approach_,
                                      pdt_, cl_time_);
        }

        //When we are doing client side prediction, we smooth out our position
        //across frames using local input states we have stored.
        this.update_local_position(cl_predict_, pdt_);

        //Work out the fps average
        this.refresh_fps_();
    }

    process_net_updates_(sv_updates_, cl_predict_, naive_approach_, pdt_, cl_time_)
    {
        //No updates...
        if (!sv_updates_.length) { return; }

        //First : Find the position in the updates, on the timeline
        //We call this current_time, then we find the past_pos and the target_pos using this,
        //searching throught the sv_updates array for current_time in between 2 other times.
        // Then :  other avatar position = lerp ( past_pos, target_pos, current_time );

        //Find the position in the timeline of updates we stored.
        let current_time = cl_time_,
            count = sv_updates_.length - 1,
            target = null,
            previous = null;

        //We look from the 'oldest' updates, since the newest ones
        //are at the end (list.length-1 for example). This will be expensive
        //only when our time is not found on the timeline, since it will run all
        //samples. Usually this iterates very little before breaking out with a target.
        for (let i = 0; i < count; ++i)
        {
            let point = sv_updates_[i],
                next_point = sv_updates_[i + 1];

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
            target = sv_updates_[0];
            previous = sv_updates_[0];
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
        let latest_sv_data = sv_updates_[sv_updates_.length - 1];


        let other_sv_pos,
            other_sv_target_pos,
            other_target_pos,
            other_past_pos;
        if (this.avatars[0].host)
        {
            //These are the exact server positions from this tick, but only for the ghost
            other_sv_pos = latest_sv_data.pos[1];
            //The other avatars positions in this timeline, behind us and in front of us
            other_target_pos =  target.pos[1];
            other_past_pos =  previous.pos[1];
        }
        else
        {
            //These are the exact server positions from this tick, but only for the ghost
            other_sv_pos = latest_sv_data.pos[0];
            //The other avatars positions in this timeline, behind us and in front of us
            other_target_pos = target.pos[0];
            other_past_pos = previous.pos[0];
        }

        //update the dest block, this is a simple lerp
        //to the target from the previous point in the sv_updates buffer
        this.ghosts[1].pos = cm.new_pos(other_sv_pos);
        this.dests[1].pos = cm.v_lerp(other_past_pos, other_target_pos, time_point);

        this.avatars[1].pos = this.update_pos_(this.avatars[1], this.dests[1].pos, pdt_);

        //Now, if not predicting client movement , we will maintain the local avatar position
        //using the same method, smoothing the avatars information from the past.
        if (!cl_predict_ && !naive_approach_)
        {
            let my_sv_pos,
                my_target_pos,
                my_past_pos;
            if (this.avatars[0].host)
            {
                //These are the exact server positions from this tick, but only for the ghost
                my_sv_pos = latest_sv_data.pos[0];
                //The other avatars positions in this timeline, behind us and in front of us
                my_target_pos = target.pos[0];
                my_past_pos = previous.pos[0];
            }
            else
            {
                //These are the exact server positions from this tick, but only for the ghost
                my_sv_pos = latest_sv_data.pos[1];
                //The other avatars positions in this timeline, behind us and in front of us
                my_target_pos = target.pos[1];
                my_past_pos = previous.pos[1];
            }

            //Snap the ghost to the new server position
            this.ghosts[0].pos = cm.new_pos(my_sv_pos);
            let local_target = cm.v_lerp(my_past_pos, my_target_pos, time_point);

            // Smoothly follow the destination position
            this.avatars[0].pos = this.update_pos_(this.avatars[0], local_target, pdt_);
        }
    }

    update_pos_(item_, target_pos_, pdt_)
    {
        if (this.cl_smoothing) { return cm.v_lerp(item_.pos, target_pos_, pdt_ * this.cl_smooth); }
        return cm.new_pos(target_pos_);
    }

    update_local_position(cl_predict_, pdt_)
    {
        if (!cl_predict_) { return; }

        //Work out the time we have since we updated the state
        let t = (cm.get_owntime() - this.avatars[0].state_time) / pdt_;

        //Then store the states for clarity,
        let old_state = this.avatars[0].old_state.pos;
        let current_state = this.avatars[0].cur_state.pos;

        //Make sure the visual position matches the states we have stored
        // this.avatars[0].pos = cm.v_add(old_state,
        //                                  cm.v_mul_scalar(cm.v_sub(current_state,
        //                                                           old_state), t ));
        this.avatars[0].pos = current_state;

        //We handle collision on client if predicting.
        cm.check_collision(this.avatars[0]);
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
