class SvSession
{
    constructor(socket_, cl_id_)
    {
        let UUID = require('node-uuid');
        this.id = UUID(); // generate a new id for the session

        this.socket_host =  socket_; // so we know who initiated the session
        this.socket_client =  null; // nobody else joined yet, since its new
        this.avatar_count =  1;

        this.frame_time_ = 45; //on server we run at 45ms, 22hz
        this.sv_time = 0;
        this.last_time = 0;
        this.laststate = {};

        // Model distribution
        let sv_mdl = new SvModel();
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
    update(t_)
    {
        //Update the session specifics
        //Update the state of our local clock to match the timer
        this.sv_time = cm.get_owntime();

        this.laststate = { pos: this.avatars.map((a_) => { return a_.pos; }),
                           inp_seq: this.avatars.map((a_) => { return a_.last_input_seq; }),
                           t: this.sv_time }; // our current local time on the server

        for (let avatar of this.avatars)
        { if (avatar.socket) { avatar.socket.emit('onserverupdate', this.laststate); } }

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
                    //now look for/create a new session.
                    return this.socket_host;
                }
            }
        }
        return null;
    }

    try_to_start(cl_socket_, cl_id_)
    {
        //If the session is a avatar short
        if (this.avatar_count >= 2) { return false; } //if more than 2 avatars

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
        //Handle avatars
        for (let avatar of this.avatars)
        {
            avatar.old_state.pos = cm.new_pos(avatar.pos);
            avatar.pos = cm.v_add(avatar.old_state.pos, cm.process_input(avatar));
        }

        //Keep the physics position in the world
        for (let avatar of this.avatars)
        {
            cm.check_collision(avatar);
            avatar.inputs = [];
        }
    }

    handle_input(cl_, input_, input_time_, input_seq_)
    {
        //Fetch which client this refers to out of the two
        let input_socket = cl_.userid == this.socket_host.userid ? this.avatars[0] : this.avatars[1];
        //Store the input on the avatar instance for processing in the physics loop
        input_socket.inputs.push({ inputs: input_, time: input_time_, seq: input_seq_ });
    }
}
