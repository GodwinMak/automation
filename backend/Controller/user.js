const db = require("../Models");

const Users = db.users;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const user = require("../Models/user");

exports.create = async (req, res) => {
  try {
    const { email, password } = req.body;

    const userCheck = await Users.findOne({ where: { email: email } });

    if (userCheck) {
      return res.status(409).send({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(Number(10));
    const hashedPassword = await bcrypt.hash(password, salt);

    const username = email.split("@")[0];

    const newUser = await Users.create({
      username,
      email,
      password: hashedPassword,
    });

    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(201).send({
      message: "User created successfully",
      user: newUser,
      token,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Users.findOne({ where: { email: email } });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).send({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).send({
      message: "Login successful",
      user,
      token,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
};

exports.updateById = async (req, res) => {
  try {
    const userId = req.params.id;
    const {email, password } = req.body;
    const user = await Users.findByPk(userId);

    if (!user) {
      console.log("here")
      return res.status(404).send({ message: "User not found" });
    }

    if (email) {
      user.email = email;
      user.username = email.split("@")[0]; // Update username if email changes
    }

    if (password) {
      const salt = await bcrypt.genSalt(Number(10));
      user.password = await bcrypt.hash(password, salt);
    }

    await user.save();

    res.status(200).send({ message: "User updated successfully", user });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
}

exports.deleteById = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await Users.findByPk(userId);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    await user.destroy();

    res.status(200).send({ message: "User deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: err.message });
  }
}
