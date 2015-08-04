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
