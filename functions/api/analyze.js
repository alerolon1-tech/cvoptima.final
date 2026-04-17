<!DOCTYPE html>
<html>
<head>
<title>Analizador de CV</title>

<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/build/pdf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<style>

body{
font-family:Arial;
margin:40px;
background:#f4f6f8;
}

.container{
background:white;
padding:30px;
border-radius:10px;
max-width:900px;
margin:auto;
}

.score{
font-size:32px;
font-weight:bold;
margin-top:20px;
}

.bar{
height:20px;
background:#ddd;
margin-bottom:10px;
border-radius:5px;
}

.fill{
height:100%;
background:#2c7be5;
border-radius:5px;
}

.alert{
color:#c0392b;
}

.reco{
color:#27ae60;
}

</style>

</head>

<body>

<div class="container">

<h1>Analizador de CV</h1>

<input type="file" id="fileInput">

<br><br>

<button onclick="analizarCV()">Analizar CV</button>

<div id="resultado"></div>

<h3>Radar del CV</h3>

<canvas id="radar"></canvas>

</div>

<script>

async function analizarCV(){

const file = document.getElementById("fileInput").files[0]

if(!file){
alert("Subí un CV primero")
return
}

const reader = new FileReader()

reader.onload = async function(){

const typedarray = new Uint8Array(this.result)

const pdf = await pdfjsLib.getDocument(typedarray).promise

let texto = ""

for(let i=1;i<=pdf.numPages;i++){

let page = await pdf.getPage(i)

let content = await page.getTextContent()

let strings = content.items.map(item => item.str)

texto += strings.join(" ")

}

analizarTexto(texto)

}

reader.readAsArrayBuffer(file)

}

function analizarTexto(texto){

texto = texto.toLowerCase()

let palabras = texto.split(" ").length

let estructura = texto.includes("experiencia") ? 80 : 40

let keywords = texto.includes("gestión") ? 70 : 50

let semantica = palabras > 400 ? 75 : 45

let coherencia = texto.includes("logro") ? 70 : 50

let rol = texto.includes("analista") ? 70 : 50

let score = Math.round(
(estructura + keywords + semantica + coherencia + rol)/5
)

mostrarResultados(score,estructura,keywords,semantica,coherencia,rol)

}

function mostrarResultados(score,e,k,s,c,r){

document.getElementById("resultado").innerHTML =

"<div class='score'>Score del CV: "+score+"/100</div>"+

crearBarra("Estructura",e)+
crearBarra("Keywords",k)+
crearBarra("Semántica",s)+
crearBarra("Coherencia",c)+
crearBarra("Orientación a rol",r)+

"<p class='alert'>Alertas: revisar logros cuantificables</p>"+

"<p class='reco'>Recomendación: usar más verbos de impacto</p>"

crearRadar(e,k,s,c,r)

}

function crearBarra(nombre,valor){

return "<p>"+nombre+"</p>"+
"<div class='bar'><div class='fill' style='width:"+valor+"%'></div></div>"

}

function crearRadar(e,k,s,c,r){

new Chart(document.getElementById("radar"),{

type:"radar",

data:{
labels:[
"Estructura",
"Keywords",
"Semántica",
"Coherencia",
"Rol"
],

datasets:[{

label:"Calidad del CV",

data:[e,k,s,c,r]

}]
},

options:{
scales:{
r:{
min:0,
max:100
}
}
}

})

}

</script>

</body>

</html>
