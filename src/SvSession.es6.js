class SvSession
{
    constructor(socket_)
    {
        let UUID = require('node-uuid');

        this.id = UUID(); // generate a new id for the session
        this.socket_host =  socket_; // so we know who initiated the session
        this.socket_client =  null; // nobody else joined yet, since its new
        this.avatar_count =  1;

        this.frame_time_ = 45; //on server we run at 45ms, 22hz
        this.server_time = 0;
        this.last_time = 0;
        this.laststate = {};

        // Model distribution
        let sv_mdl = new SvModel();
        sv_mdl.get_avatar_json();

        //We create a avatar set, passing them
        //the session that is running them, as well
        this.avatars = { self: new Avatar(this.socket_host),
                         other: new Avatar(this.socket_client) };
        this.avatars.self.pos = { x: 20, y: 20 };
        cm.start_physics_loop(this);
    }

    //Main update loop
    update(t_)
    {
        //Update the session specifics
        //Update the state of our local clock to match the timer
        this.server_time = cm.get_owntime();

        //Make a snapshot of the current state, for updating the clients
        this.laststate = { hp: this.avatars.self.pos, //'host position', the session creators position
                           cp: this.avatars.other.pos, //'client position', the person that joined, their position
                           his: this.avatars.self.last_input_seq, //'host input sequence', the last input we processed for the host
                           cis: this.avatars.other.last_input_seq, //'client input sequence', the last input we processed for the client
                           t: this.server_time }; // our current local time on the server

        //Send the snapshot to the 'host' avatar
        if (this.avatars.self.socket) { this.avatars.self.socket.emit('onserverupdate', this.laststate); }
        //Send the snapshot to the 'client' avatar
        if (this.avatars.other.socket) { this.avatars.other.socket.emit('onserverupdate', this.laststate); }

        let currTime = Date.now(),
            timeToCall = Math.max(0, this.frame_time_ - (currTime - this.last_time));

        //schedule the next update
        this.updateid = setTimeout(() => { this.update(currTime + timeToCall); }, timeToCall);
        this.last_time = currTime + timeToCall;
    }

    stop(user_id_)
    {
        clearTimeout(this.updateid);

        //if the session has two avatars, the one is leaving
        if (this.avatar_count > 1)
        {
            //send the avatars the message the session is ending
            if (user_id_ == this.socket_host.userid)
            {
                //the host left, oh snap. Lets try join another session
                if (this.socket_client)
                {
                    //tell them the session is over
                    this.socket_client.send('s.e');
                    //now look for/create a new session.
                    return this.socket_client;
                }
            }
            else
            {
                //the other avatar left, we were hosting
                if (this.socket_host)
                {
                    //tell the client the session is ended
                    this.socket_host.send('s.e');
                    //i am no longer hosting, this session is going down
                    this.socket_host.hosting = false;
                    //now look for/create a new session.
                    return this.socket_host;
                }
            }
        }
        return null;
    }

    try_to_start(socket_)
    {
        //If the session is a avatar short
        if (this.avatar_count >= 2) { return false; } //if more than 2 avatars

        //increase the avatar count and store
        //the avatar as the client of this session
        this.socket_client = socket_;
        this.avatars.other.socket = socket_;
        this.avatar_count++;

        //start running the session on the server,
        //which will tell them to respawn/start
        this.start();
        return true;
    }

    start()
    {
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
    update_physics(pdt_)
    {
        //Handle avatar one
        this.avatars.self.old_state.pos = cm.new_pos(this.avatars.self.pos);
        this.avatars.self.pos = cm.v_add(this.avatars.self.old_state.pos,
                                         cm.process_input(this.avatars.self));

        //Handle avatar two
        this.avatars.other.old_state.pos = cm.new_pos(this.avatars.other.pos);
        this.avatars.other.pos = cm.v_add(this.avatars.other.old_state.pos,
                                          cm.process_input(this.avatars.other));

        //Keep the physics position in the world
        cm.check_collision(this.avatars.self);
        cm.check_collision(this.avatars.other);

        this.avatars.self.inputs = []; //we have cleared the input buffer, so remove this
        this.avatars.other.inputs = []; //we have cleared the input buffer, so remove this
    }

    handle_input(client_, input_, input_time_, input_seq_)
    {
        //Fetch which client this refers to out of the two
        let socket_client = client_.userid == this.avatars.self.socket.userid ? this.avatars.self : this.avatars.other;
        //Store the input on the avatar instance for processing in the physics loop
        socket_client.inputs.push({ inputs: input_, time: input_time_, seq: input_seq_ });
    }
}
