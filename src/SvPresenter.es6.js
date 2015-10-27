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
                else { /* console.log('Sent:', file); */ } });
        });
    }

    init_socket()
    {
        /* Socket.IO server set up. */

        //Express and socket.io can work together to serve the socket.io client files for you.
        //This way, when the client requests '/socket.io/' files, socket.io determines what the client needs.

        //Create a socket.io instance using our express server
        let io = require('socket.io'),
            UUID = require('node-uuid'),
            sio = io.listen(this.httpd);

        //Configure the socket.io connection settings.
        //See http://socket.io/
        sio.use((socket_, next_) => { let handshake = socket_.request; next_(); });

        //Enter the session server code. The session server handles
        //client connections looking for a session, creating sessions,
        //leaving sessions, joining sessions and ending sessions when they leave.

        //Socket.io will call this function when a client connects,
        //So we can send that client looking for a session to play,
        //as well as give that client a unique ID to use so we can
        //maintain the list if avatars.
        sio.sockets.on('connection', (socket_) => {
            let cl_id = UUID();
            //now we can find them a session to play with someone.
            //if no session exists with someone waiting, they create one and wait.
            let accepted_session = this.find_session_(socket_, cl_id);

            //Useful to know when someone connects
            console.log('\t avatar: ' + accepted_session.id + ' connected');

            //// register events
            //Now we want to handle some of the messages that clients will send.
            //They send messages here, and we send them to the sv to handle.
            socket_.on('message', (msg_) => { this.on_recv_message_(socket_, cl_id, msg_); });

            //When this client disconnects, we want to tell the session server
            //about that as well, so it can remove them from the session they are
            //in, and make sure the other avatar knows that they left and so on.
            socket_.on('disconnect', () => {
                //Useful to know when soomeone disconnects
                console.log('\t socket.io:: client disconnected ' + cl_id + ' ' + accepted_session.id);
                //If the client was in a session, set by sv.find_session_,
                //we can tell the session server to update that session state.
                if (socket_ && accepted_session.id)
                {
                    //avatar leaving a session should destroy that session
                    this.destroy_session_(accepted_session.id, cl_id);
                }
            });
        });
    }

    log_() { if (this.verbose) { console.log.apply(this, arguments); } }

    on_recv_message_(socket_, cl_id_, packet_)
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
        let packet_parts = packet_.split('.'),
        //The first is always the type of packet
            packet_type = packet_parts[0];

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
        let input_commands = parts_[1].split('-'),
            input_time = parts_[2].replace('-', '.'),
            input_seq = parts_[3];

        //the client should be in a session, so
        //we can tell that session to handle the input
        if (socket_ && socket_.session)
        { socket_.session.handle_input(socket_, input_commands, input_time, input_seq); }
    }

    find_session_(cl_socket_, cl_id_)
    {
        //Generate a new UUID, looks something like
        //5b2ca132-64bd-4513-99da-90e838ca47d1
        //and store this on their socket/connection
        cl_socket_.userid = cl_id_;

        //tell the avatar they connected, giving them their id
        cl_socket_.emit('onconnected', { id: cl_id_ });

        this.log_('looking for a session. We have : ' + this.session_count);
        //if there are any sessions at all, no sessions? create one!
        if (!this.session_count) { return this.create_session_(cl_socket_, cl_id_); }

        //so there are sessions active,
        //lets see if one needs another avatar
        let joined_a_session = false, found_session = null;
        //Check the list of sessions for an open session
        for (let session_id in this.sessions) // for all sessions
        {
            //only care about our own properties.
            if (!this.sessions.hasOwnProperty(session_id)) { continue; }
            //get the session we are checking against
            found_session = this.sessions[session_id];
            //someone wants us to join!
            joined_a_session = found_session.try_to_start(cl_socket_, cl_id_) || joined_a_session;
        }

        //now if we didn't join a session,
        //we must create one
        if (!joined_a_session) { return this.create_session_(cl_socket_, cl_id_); }
        return found_session;
    }

    create_session_(host_socket_, cl_id_)
    {
        //Create a new session instance, this actually runs the
        //session code like collisions and such.
        let session = new SvSession(host_socket_, cl_id_);

        //Store it in the list of session
        this.sessions[session.id] = session;
        //Keep track
        this.session_count++;
        //Start updating the session loop on the server
        session.update(new Date().getTime());

        host_socket_.session = session;

        console.log('server host at  ' + cm.get_owntime());
        this.log_('host ' + cl_id_ + ' created a session with id ' + host_socket_.session.id);
        //return it
        return session;
    }

    destroy_session_(session_id_, userid_)
    {
        let session = this.sessions[session_id_];
        if (!session) { this.log_('that session was not found!'); return; }

        //stop the session updates immediate
        let left_socket = session.stop(userid_);
        if (left_socket) { this.find_session_(left_socket); }

        delete this.sessions[session_id_];
        this.session_count--;
        this.log_('session removed. there are now ' + this.session_count + ' sessions');
    }
};

// on node.js
let server = new SvPresenter();
server.init_httpd();
server.init_socket();
