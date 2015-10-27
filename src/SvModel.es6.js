// http://stackoverflow.com/questions/30339675/how-to-map-json-data-to-a-class

/*
 The avatar class
 A simple class to maintain state of a avatar on screen.
*/
class Avatar
{
    constructor(socket_)
    {
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
        if (this.socket) { this.pos = { x: 20, y: 20 }; }
        else { this.pos = { x: 500, y: 200 }; }
    }
};

class SvModel
{
    constructor()
    {
    }

    get_avatar_json()
    {
        let avatar = new Avatar();
        avatar.state_time = 0;

        return JSON.stringify(avatar);
    }
};
