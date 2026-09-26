require("dotenv").config();
const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const supabase = require("./config/db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API rodando corretamente.");
});

app.use("/api", routes);

const PORT = process.env.PORT;
app.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);

  try {
    // Tenta ler uma tabela ou apenas disparar uma query simples no PostgREST
    const { error } = await supabase
      .from("usuarios")
      .select("id_usuario")
      .limit(1);

    if (error && error.code !== "PGRST116" && error.status !== 404) {
      throw error;
    }
    console.log("⚡ Conexão com o Supabase estabelecida com sucesso!");
  } catch (err) {
    console.error(
      "❌ Erro ao conectar no Supabase. Verifique seu arquivo .env:",
      err.message,
    );
  }
});
