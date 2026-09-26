const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const multer = require("multer");
const studentController = require("../controllers/student/studentController");
const studentFileController = require("../controllers/studentFile/studentFileController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

// Mantém o CSV em memória (buffer) — é pequeno e só precisamos ler o texto
// e repassar uma cópia pro Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Arquivos do aluno (fotos/documentos) podem ser maiores que o CSV de
// importação, por isso uma instância própria do multer com limite maior.
const uploadStudentFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Todas as rotas de alunos exigem autenticação ativa E a permissão "alunos"
router.use(authMiddleware);
router.use(subscriptionGuard);
router.use(requirePermission(["alunos"]));

router.post("/", studentController.createNewStudent);
router.get("/", studentController.getCompanyStudents);
router.get("/:id", studentController.getStudent);
router.put("/:id", studentController.editCompanyStudent);
router.post(
  "/import",
  upload.single("file"),
  studentController.importStudentsFromCsv,
);

router.get("/:id/files", studentFileController.getStudentFiles);
router.post(
  "/:id/files",
  uploadStudentFile.single("file"),
  studentFileController.uploadStudentFile,
);
router.delete("/:id/files/:fileId", studentFileController.deleteStudentFile);

module.exports = router;
