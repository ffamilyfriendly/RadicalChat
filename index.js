// CONFIG
const debug = false
const admin = "familyfriendly"

const Database = require("better-sqlite3")
const db = new Database("./data.db")
const server = require('http').createServer();
const io = require('socket.io')(server)
const connections = new Map()

const ctUsers = db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL, banned INTEGER DEFAULT 0)")
ctUsers.run()

const ctMsges = db.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, author INTEGER NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL)")
ctMsges.run()

const genUser = (username,ip) => {
    return new Promise(( resolve,reject ) => {
        if(username.length > 20 ||username.length < 2) return reject( { type:"no", reason:"config issue" } )
        const stmt = db.prepare("SELECT * FROM users WHERE username = ? OR ip = ?")
        let data = stmt.get(username,ip)
        if(!data || data.username == username && data.ip == ip) {
            if(!data) {
                data = { username:username, ip:ip, created: Date.now() }
                const stmtNewUser = db.prepare("INSERT INTO users (username,ip,created) VALUES(?,?,?)")
                const newData = stmtNewUser.run(username,ip,Date.now())
                data.id = newData.lastInsertRowid
            }
            return resolve( { type:"ok", reason:"welcome!", data: data } )
        }
        if(username == data.username && ip != data.ip) return resolve( { type:"no", reason:"username exists under different IP" } )
        if(ip == data.ip && username != data.username) return resolve( { type:"no", reason:`you already have an account, ${data.username}` } )
    })
}

const doMsg = (content, author) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO messages (author, content, created) VALUES (?,?,?)")
        const data = stmt.run(author, content, Date.now())
        resolve( { type:"ok", data: { id: data.lastInsertRowid, content, author, created: Date.now() } } )
    })
}

const getChatHistory = () => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("SELECT a.id as msgid, a.created as msgcreated, a.content, a.author, b.username, b.created FROM messages a INNER JOIN users b ON b.id = a.author")
        const data = stmt.all()
        resolve({ type:"ok", data })
    })
}

const getUser = (username) => {
    const stmt = db.prepare("SELECT * FROM users WHERE username = ?")
    return stmt.get(username)
}

const banUser = (banned, username) => {
    connections.forEach(c => {
        if(c.user.username == username) c.user.banned = banned
    })
    const stmt = db.prepare("UPDATE users SET banned = ? WHERE username = ?")
    return stmt.run(banned,username)
}

const clearMessages = (id) => {
    const stmt = db.prepare("DELETE FROM messages WHERE author = ?")
    return res = stmt.run(id)
}

io.on("connection", client => {

    const ip = client.handshake.headers['X-Real-IP'] || client.handshake.address.address;

    client.on("hello", async (uObj) => {
        if(!uObj || !uObj.username) return client.emit("err",{ you:"dumb", reason:"missing required field" })
        else if(uObj.username.length > 20) return client.emit("err", { you:"dumb", reason:"config issue" })
        console.log(`someone trying to log in as ${uObj.username} with ip ${ip}`)
        const ans = await genUser(uObj.username, debug ? uObj.username : ip)

        if(ans.type == "no") {
            return client.emit("err", { you:"dumb", reason:ans.reason })
        } else {
            connections.set(client.id,{ client, user: ans.data })
            io.emit("chat", { type:"welcome", data: ans.data.username, members:connections.size })
            return client.emit("ok", { you:ans.data.username, reason:"welcome!", data: { members: connections.size } })
        }
    })

    client.on("chat", async (msg) => {
        if(!connections.has(client.id)) return client.emit("err", { you:"dumb", reason:"You mischievous bastard! You need to log in to chat" })
        if(!msg || !msg.content || msg.content.length > 400) return client.emit("err", { you:"dumb", reason:"config issue" } )
        
        if(connections.get(client.id).user.banned) {
            const usernameWallah = connections.get(client.id).user.username
            client.emit("chat", { type:"message", digest:`${usernameWallah}: ${msg.content}` , data: { content: msg.content, author: { username: usernameWallah}, created: Date.now() }, members: connections.size } )
            return
        }
        
        const status = await doMsg(msg.content, connections.get(client.id).user.id)
        if(status.type == "ok") {
            if(connections.get(client.id).timeout) return client.emit("cmd", { cmd:"whois", html:`<b style="color:red;">RATELIMIT</b> calm down there, cowpoke` })
            let u = connections.get(client.id).user
            delete u.ip
            status.data.author = u
            io.emit("chat", { type:"message", digest:`${u.username}: ${status.data.content}` , data: status.data, members: connections.size } )
            connections.get(client.id).timeout = true
            setTimeout(() => {
                connections.get(client.id).timeout = false
            }, 1000)
        }
    })

    client.on("cmd", (msg) => {
        
        if(!connections.has(client.id)) return client.emit("err", { you:"dumb", reason:"You mischievous bastard! You need to log in to use cmds" })
        if(connections.get(client.id).user.username != admin) return client.emit("err", { you:"dumb", reason:"lmao, no!" })
        console.log(msg)
        switch(msg.cmd) {
            case "whois":
                if(!msg.args[0]) return client.emit("cmd", { cmd:"whois", html:`<b>syntax:</b> /whois [username]` })
                const user = getUser(msg.args[0])
                if(user) client.emit("cmd", { cmd:"whois", html: `<b>${user.username}</b> has IP <code>${user.ip}</code> and id <b>${user.id}</b>` })
                else client.emit("cmd", { cmd:"whois", html: `<b>${msg.args[0]}:</b> no such user` })
            break;

            case "ban":
                if(!msg.args[0]) return client.emit("cmd", { cmd:"whois", html:`<b>syntax:</b> /ban [username]` })
                banUser(1,msg.args[0])
                client.emit("cmd", { cmd:"whois", html: `banned <b>${msg.args[0]}</b>` })
            break;

            case "unban":
                if(!msg.args[0]) return client.emit("cmd", { cmd:"whois", html:`<b>syntax:</b> /unban [username]` })
                banUser(0,msg.args[0])
                client.emit("cmd", { cmd:"whois", html: `unbanned <b>${msg.args[0]}</b>` })
            break;

            case "clear": 
                if(!msg.args[0]) return client.emit("cmd", { cmd:"whois", html:`<b>syntax:</b> /clear [id]` })
                const res = clearMessages(msg.args[0])
                client.emit("cmd", { cmd:"whois", html: `cleared <b>${res.changes}</b> messages` })
            break;
        }
    })

    client.on("history", async () => {
        if(!connections.has(client.id)) return client.emit("err", { you:"dumb", reason:"You mischievous bastard! You need to log in to get that" })
        const chatHistory = await getChatHistory()
        if(chatHistory.type == "ok") client.emit("chat", { type: "bulk", data: chatHistory.data, digest: `loaded ${chatHistory.data.length} messages` } )
        else client.emit("err", { you:"innocent?", reason:"something went wackers fetching messages. Sorry!" })
    })

    client.on("disconnect", () => {
        if(connections.has(client.id)) {
            console.log(`${connections.get(client.id).user.username} disconnected`)
            connections.delete(client.id)
        }
    })

})

server.listen(3000)