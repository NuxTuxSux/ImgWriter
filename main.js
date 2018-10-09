const electron = require('electron')
const url = require('url')
const path = require('path')
const getPixels = require('get-pixels')
const savePixels = require('save-pixels')
const zeros = require('zeros')
const fs = require('fs')
const {Readable} = require('stream')
const tar = require('tar')


const {app, BrowserWindow, Menu, dialog, ipcMain} = electron

let window
let imageData
let loadedFilesList = []
let tarStream
let data

app.on('ready', function () {
    window = new BrowserWindow({frame:false, autoHideMenuBar: true, height:700, transparent: true})


    window.loadURL(url.format({
        pathname: path.join(__dirname, 'window.html'),
        protocol: 'file:',
        slashes: true
    }))
    window.on('closed', function () { app.quit() })

})

ipcMain.on('open', function () {
    imgpath = dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{name:'PNG Images', extensions:['png']}]})
    if (!imgpath)
        return
    window.webContents.send('load', imgpath[0])
    getPixels(imgpath[0], function (err, data) {
        if (err) {
            console.log('Bad image')
            return
        }
        imageData = data
    })
})

ipcMain.on('saveImgTxt', function (err, text) {
    writeStrToImage(text)
})

ipcMain.on('saveImgFiles', function (err, fileList) {
    // Sarebbe meglio usare uno string builder-buffer, ottimizzazione successiva !!
    console.log(fileList)
    var buffer = ''
    tar.c(fileList).on('data', function (text) {
        buffer += text
    }).on('end', function (err) {
        if (err) {
            console.log('Error:' + err)
            return
        }
        writeStrToImage(buffer)
    })
})

function writeStrToImage(text) {
    if (!imageData) {
        console.log('Image not loaded yet')
        return
    }

    if (!text) {
        console.log('There\'s no data to save')
        return
    }

    // dapprima suppongo che la png abbia già il canale alpha!!
    var ch
    var px
    const width = imageData.shape[0]

    // controlla se ci sono dati da salvare

    // destino i primi tre byte alla dimensione dell'output
    var dimByte = text.length

    for (x = 0; x < 3; x++) {
        for (j = 0; j < 4; j++) {
            px = imageData.get(x, 0, j) >> 2
            imageData.set(x, 0, j, 4 * px + (dimByte & 3))
            dimByte >>= 2
        }
    }
    for (i = 3; i < text.length + 3; i++) {

        ch = text[i-3].charCodeAt(0)
        x = i % width
        y = Math.floor(i/width)

        // r,g,b,a saranno in ordine crescente di significatività

        for (j = 0; j < 4; j++) {
            // tolgo gli ultimi due bit da ogni canale e li rimpiazzo con la
            // corrispondente coppia di bit del carattere
            px = imageData.get(x, y, j) >> 2
            imageData.set(x,y,j,4 * px + (ch & 3))
            ch >>= 2
        }
    }

    
    imgpath = dialog.showSaveDialog(window, { filters: [{name:'PNG Images', extensions:['png']}]})
    const outFile = fs.createWriteStream(imgpath)
    
    savePixels(imageData, "png").pipe(outFile)

}


function readStrFromImage() {
    // !! stringbuilder
    var byte = 0, len, text = ''
    const width = imageData.shape[0]

    for (x = 0; x < 3; x++) {
        for (j = 0; j < 4; j++) {
            byte += (imageData.get(x, 0, j) % 4) << (2*(j+4*x))
        }
    }
    len = byte

    for (i = 3; i < len + 3; i++) {
        byte = 0
        for (j = 0; j < 4; j++) {
            byte += (imageData.get(i % width, Math.floor(i/width), j) % 4) << (2*j)
        }
        text += String.fromCharCode(byte)
    }
    return text
}

ipcMain.on('loadImgTxt', function (err, text) {
    window.webContents.send('textRead', readStrFromImage())
})

function getTarStream() {
    tarStr = readStrFromImage()

    const tarStream = new Readable()
    tarStream._read = () => {}
    tarStream.push(tarStr)
    tarStream.push(null)
    return tarStream
}

ipcMain.on('loadImgFiles', function (err) {    
    loadedFilesList = []

    getTarStream().pipe(
        tar.t({
            onentry: entry => {
                splittedPath = entry['path'].split('/')
                loadedFilesList.push([splittedPath.pop(), splittedPath.join('/'), entry['size']])
            }

        })
    ).on('end',function () {
        window.webContents.send('filesRead', loadedFilesList)
    })
})

ipcMain.on('addFile', function (err) {
    paths = dialog.showOpenDialog(window,{ properties: ['multiSelections'] })
    window.webContents.send('addFile', paths.map(makeTableItem))
})

ipcMain.on('extract', function (err, filePaths) {
    extractPath = dialog.showOpenDialog(window, { properties:['openDirectory'] })[0]
    for (let i in filePaths) {
        // anche questo potrebbe non funzionare su windows... !!
        console.log(filePaths[i])
        let depth = filePaths[i].match(/\//g).length
        console.log(depth)

        getTarStream().pipe(
            tar.x(
                {
                    cwd: extractPath,// + filePaths[i],
                    strip: depth
                    //onentry: function (entry) {console.log(entry)}
                },
                [filePaths[i]]
            )
        )
    }
    console.log(filePaths)
})

function makeTableItem(path) {
    var splittedPath = path.split('/')
    return [splittedPath.pop(), splittedPath.join('/'), fs.statSync(path).size]
}

/* TODO
FUND
    · separare le fasi di utilizzo (aggiunta files-estrazione)

· abilitare/disabilitare pulsanti all'occorrenza
· mettere in basso una status bar
· alert se provo a salvare prima di aver caricato
    l'immagine - oppure abilitare il pulsante solo
    quando l'ho caricata

---- gui
· eliminare quei minchia di angolini
· renderlo più carino all'apertura
· eliminare il focus dalla textarea



*/