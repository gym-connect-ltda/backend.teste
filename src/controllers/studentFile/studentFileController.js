const studentFileService = require("../../services/studentFile/studentFileService");
const auditService = require("../../services/audit/auditService");

const getStudentFiles = async (req, res) => {
  const { id_empresa: companyId } = req.user;
  const { id: studentId } = req.params;

  try {
    const files = await studentFileService.listStudentFiles(studentId, companyId);
    return res.json(files);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const uploadStudentFile = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id: studentId } = req.params;

  try {
    const file = await studentFileService.uploadStudentFile({
      studentId,
      companyId,
      userId,
      file: req.file,
    });

    auditService.logAction({
      companyId,
      userId,
      branchId: userBranchId,
      action: "Cadastrou/Importou",
      description: `Adicionou o arquivo "${file.name}" ao aluno (id ${studentId})`,
    });

    return res.status(201).json({ message: "Arquivo enviado com sucesso!", ...file });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const deleteStudentFile = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id: studentId, fileId } = req.params;

  try {
    await studentFileService.deleteStudentFile(studentId, fileId, companyId);

    auditService.logAction({
      companyId,
      userId,
      branchId: userBranchId,
      action: "Removeu",
      description: `Removeu um arquivo do aluno (id ${studentId})`,
    });

    return res.json({ message: "Arquivo removido com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = { getStudentFiles, uploadStudentFile, deleteStudentFile };
