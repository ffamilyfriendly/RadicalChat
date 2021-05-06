// page might be 90s but fuck writing not es6

const socket = io("http://localhost:3000")

const uhOh = ( type = "type", reason = "reason" ) => {
    document.getElementById("error").innerHTML = type.bold() + ": " + reason
}

const sendMsg = () => {
    const msg = document.getElementById("msg")
    if(!msg.value) return uhOh("config issue", "message needs to actually contain words")
    if(msg.value.length > 400) msg.value = "I am dumb and furthermore I am not an anime girl"
    if(msg.value.startsWith("/")) {
        let args = msg.value.split(" ")
        let cmd = args[0].substr(1)
        args.shift()
        socket.emit("cmd", { cmd, args } )
    } else {
        socket.emit("chat", { content:msg.value } )
    }
    msg.value = ""
}

const padNumber = (nr) => nr.toString().length === 1  ? `0${nr}` : nr

const createMessage = (username, content, created) => {
    location.href = "#talk"
    let main = document.createElement("p")
    let uName = document.createElement("b")
    let mContent = document.createElement("span")
    let timeStamp = document.createElement("small")
    uName.innerText = username
    mContent.innerText = " " + content
    timeStamp.dateTime = created

    let mDate = new Date(created)
    timeStamp.innerText = `${mDate.toDateString()} at ${padNumber(mDate.getHours())}:${padNumber(mDate.getMinutes())}`

    main.append(uName,mContent)
    return [ main, timeStamp ]
}

const joinRoom = () => {
    alert("JOINING ROOM!!!!!!")
    const username = document.getElementById("username")
    if(!username.value) return alert("you did not set a username")

    socket.emit("hello", { username: username.value } )

    socket.on("ok", (data) => {
        console.log(data)
        document.getElementById("talk").style.display = "inherit"
        document.getElementById("login").style.display = "none"
        uhOh("Logged in!",data.reason)
        console.log("getting chat history")
        socket.emit("history")
    })

    socket.on("err", (data) => {
        uhOh("config issue",data.reason)
        console.log(data)
    })

    const c = document.getElementById("chat")

    socket.on("cmd", (msg) => {
        let e = document.createElement("li")
        e.innerHTML = msg.html
        e.classList = `cmd ${msg.cmd}`
        c.append(e)
    })

    socket.on("chat", (msg) => {
        console.log(msg)
        uhOh("Info", msg.digest||msg.data)
        document.getElementById("chatTitle").innerText = `You are chatting with ${msg.members} other(s)`
        let e = document.createElement("li")
        e.classList = msg.type

        switch(msg.type) {
            case "welcome":
                e.innerText = `${msg.data} joined the room!`
            break;
            case "message":
                e.append(...createMessage(msg.data.author.username, msg.data.content, msg.data.created))
            break;
            case "bulk":
                e.innerHTML = `loaded <b>${msg.data.length}</b> messages`
                msg.data.forEach(bMsg => {
                    let cItem = document.createElement("li")
                    cItem.classList = "message"
                    cItem.append(...createMessage(bMsg.username, bMsg.content, bMsg.created))
                    c.append(cItem)
                })
            break;
        }

        c.append(e)
    })
}