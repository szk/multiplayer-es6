class SvPresenter
{
    constructor()
    {
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

    init_httpd()
    {
        let port = process.env.PORT || 4004,
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
        app.get('/', (req_, res_) => {
            console.log('trying to load %s', __dirname + '/index.html');
            // let file = req_.path;
            let options = { root: __dirname,
                            dotfiles: 'deny',
                            headers: { 'x-timestamp': Date.now(), 'x-sent': true } };
            // console.log("file = ", file);
            res_.sendFile('/index.html', options, (err_) => {
                if (err_)
                {
                    console.log(err_);
                    res_.status(err_.status).end();
                }
                else { /* console.log('Sent:', file); */ };
            });
        });

        // Model
        app.get('/model', (req_, res_, next_) => {
            if (this.verbose) { console.log('\t :: Express :: data requested as model'); }
            res_.json(this.model.get_avatar_json());
        });

        // This handler will listen for requests on /*, any file from the root of our server.
        // See expressjs documentation for more info on routing.

        app.get('/*', (req_, res_, next_) => {
            //This is the current file they have requested
            // let file = req.params[0];

            //Send the requesting client the file.
            // res.sendfile(__dirname + '/' + file);
            let file = req_.path;
            //For debugging, we can track what files are requested.
            if (this.verbose) { console.log('\t :: Express :: file requested : ' + file); }
            let options = { root: __dirname + '/',
                            dotfiles: 'deny',
                            headers: { 'x-timestamp': Date.now(), 'x-sent': true } };
            // console.log("file = ", file);
            res_.sendFile(file, options, (err_) => {
                if (err_)
                {
                    console.log(err_);
                    res_.status(err_.status).end();
                }
                else { console.log('Sent:', file); } });
        });
    }

    init_socket()
    {
        /* Socket.IO server set up. */

        //Express and socket.io can work together to serve the socket.io client files for you.
        //This way, when the client requests '/socket.io/' files, socket.io determines what the client needs.

        //Create a socket.io instance using our express server
        let io = require('socket.io');
        let sio = io.listen(this.httpd);

        //Configure the socket.io connection settings.
        //See http://socket.io/
        sio.use((socket_, next_) => { let handshake = socket_.request;
                                      next_(); });

        //Enter the session server code. The session server handles
        //client connections looking for a session, creating sessions,
        //leaving sessions, joining sessions and ending sessions when they leave.

        //Socket.io will call this function when a client connects,
        //So we can send that client looking for a session to play,
        //as well as give that client a unique ID to use so we can
        //maintain the list if avatars.
        let UUID = require('node-uuid');
        sio.sockets.on('connection', (socket_) => {
            //Generate a new UUID, looks something like
            //5b2ca132-64bd-4513-99da-90e838ca47d1
            //and store this on their socket/connection
            socket_.userid = UUID();

            //tell the avatar they connected, giving them their id
            socket_.emit('onconnected', { id: socket_.userid });

            //now we can find them a session to play with someone.
            //if no session exists with someone waiting, they create one and wait.
            this.find_session_(socket_);

            //Useful to know when someone connects
            console.log('\t socket.io:: socket ' + socket_.userid + ' connected');

            //Now we want to handle some of the messages that clients will send.
            //They send messages here, and we send them to the sv to handle.
            socket_.on('message', (m_) => { this.on_receive_(socket_, m_); });

            //When this client disconnects, we want to tell the session server
            //about that as well, so it can remove them from the session they are
            //in, and make sure the other avatar knows that they left and so on.
            socket_.on('disconnect', () => {
                //Useful to know when soomeone disconnects
                console.log('\t socket.io:: client disconnected ' + socket_.userid + ' ' + socket_.session.id);
                //If the client was in a session, set by sv.find_session_,
                //we can tell the session server to update that session state.
                if (socket_ && socket_.session.id)
                {
                    //avatar leaving a session should destroy that session
                    this.end_session_(socket_.session.id, socket_.userid);
                }
            });
        });
    }

    log_() { if (this.verbose) { console.log.apply(this, arguments); } }

    on_receive_(socket_, packet_)
    {
        if (this.fake_latency && packet_.split('.')[0].substr(0, 1) == 'i')
        {
            //store all input packet
            this.packets.push({ client: socket_, packet: packet_ });
            setTimeout(() => {
                if (this.packets.length)
                {
                    this.proc_packet_(this.packets[0].client, this.packets[0].packet);
                    this.packets.splice(0, 1);
                }
            },
                       this.fake_latency);
            return;
        }
        this.proc_packet_(socket_, packet_);
    }

    proc_packet_(socket_, packet_)
    {
        //Cut the packet up into sub components
        let packet_parts = packet_.split('.');
        //The first is always the type of packet
        let packet_type = packet_parts[0];

        let other_client = null;
        if (socket_.session.socket_host.userid == socket_.userid)
        { other_client = socket_.session.socket_client; }
        else { other_client = socket_.session.socket_host; }

        switch (packet_type)
        {
        case 'i': this.on_input_(socket_, packet_parts); break;// Input handler will forward this
        case 'p': socket_.send('s.p.' + packet_parts[1]); break;
        case 'c': if (other_client) { other_client.send('s.c.' + packet_parts[1]); } break; // Client changed their color!
        case 'l': this.fake_latency = parseFloat(packet_parts[1]); break; // A client is asking for lag simulation
        }
    }

    on_input_(socket_, parts_)
    {
        //The input commands come in like u-l,
        //so we split them up into separate commands,
        //and then update the avatars
        let input_commands = parts_[1].split('-');
        let input_time = parts_[2].replace('-', '.');
        let input_seq = parts_[3];

        //the client should be in a session, so
        //we can tell that session to handle the input
        if (socket_ && socket_.session)
        { socket_.session.handle_input(socket_, input_commands, input_time, input_seq); }
    }

    create_session_(socket_)
    {
        //Create a new session instance, this actually runs the
        //session code like collisions and such.
        let session = new SvSession(socket_);

        //Store it in the list of session
        this.sessions[session.id] = session;
        //Keep track
        this.session_count++;

        //Start updating the session loop on the server
        session.update(new Date().getTime());
        //tell the avatar that they are now the host
        //s=server message, h=you are hosting
        socket_.send('s.h.' + String(cm.get_owntime()).replace('.', '-'));
        console.log('server host at  ' + cm.get_owntime());
        socket_.session = session;
        socket_.hosting = true;
        this.log_('host ' + socket_.userid + ' created a session with id ' + socket_.session.id);
        //return it
        return session;
    }

    end_session_(session_id_, user_id_)
    {
        let session = this.sessions[session_id_];
        if (!session) { this.log_('that session was not found!'); return; }

        //stop the session updates immediate
        session.stop_update();
        //if the session has two avatars, the one is leaving
        if (session.avatar_count > 1)
        {
            //send the avatars the message the session is ending
            if (user_id_ == session.socket_host.userid)
            {
                //the host left, oh snap. Lets try join another session
                if (session.socket_client)
                {
                    //tell them the session is over
                    session.socket_client.send('s.e');
                    //now look for/create a new session.
                    this.find_session_(session.socket_client);
                }
            }
            else
            {
                //the other avatar left, we were hosting
                if (session.socket_host)
                {
                    //tell the client the session is ended
                    session.socket_host.send('s.e');
                    //i am no longer hosting, this session is going down
                    session.socket_host.hosting = false;
                    //now look for/create a new session.
                    this.find_session_(session.socket_host);
                }
            }
        }
        delete this.sessions[session_id_];
        this.session_count--;
        this.log_('session removed. there are now ' + this.session_count + ' sessions');
    }

    start_session_(session_)
    {
        //right so a session has 2 avatars and wants to begin
        //the host already knows they are hosting,
        //tell the other client they are joining a session
        //s=server message, j=you are joining, send them the host id
        session_.socket_client.send('s.j.' + session_.socket_host.userid);
        session_.socket_client.session = session_;

        //now we tell both that the session is ready to start
        //clients will reset their positions in this case.
        session_.socket_client.send('s.r.' + String(cm.get_owntime()).replace('.', '-'));
        session_.socket_host.send('s.r.' + String(cm.get_owntime()).replace('.', '-'));

        //set this flag, so that the update loop can run it.
        session_.active = true;
    }

    find_session_(socket_)
    {
        this.log_('looking for a session. We have : ' + this.session_count);
        //if there are any sessions at all, no sessions? create one!
        if (!this.session_count) { this.create_session_(socket_); return; }

        //so there are sessions active,
        //lets see if one needs another avatar
        let joined_a_session = false;
        //Check the list of sessions for an open session
        for (let sessionid in this.sessions) // for all sessions
        {
            //only care about our own properties.
            if (!this.sessions.hasOwnProperty(sessionid)) { continue; }
            //get the session we are checking against
            let session = this.sessions[sessionid];

            //If the session is a avatar short
            if (session.avatar_count < 2) //if less than 2 avatars
            {
                //someone wants us to join!
                joined_a_session = true;
                //increase the avatar count and store
                //the avatar as the client of this session
                session.socket_client = socket_;
                session.avatars.other.socket = socket_;
                session.avatar_count++;

                //start running the session on the server,
                //which will tell them to respawn/start
                this.start_session_(session);
            }
        }

        //now if we didn't join a session,
        //we must create one
        if (!joined_a_session) { this.create_session_(socket_); }
    }
};

// on node.js
let server = new SvPresenter();
server.init_httpd();
server.init_socket();
