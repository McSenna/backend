const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const UserSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Full name must be at least 2 characters"],
      maxlength: [100, "Full name must not exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
      index: true,
    },

    // Stored as a base64 data URI in the database (no filesystem storage).
    profilePhoto: {
      type: String,
      default: "",
      trim: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    gender: {
      type: String,
      enum: {
        values: ["male", "female", "other"],
        message: 'Gender must be "male", "female", or "other"',
      },
      required: [true, "Gender is required"],
    },
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [255, "Address must not exceed 255 characters"],
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    role: {
      type: String,
      enum: {
        values: ["admin", "doctor", "midwife", "bhw", "resident"],
        message: "Role must be admin, doctor, midwife, bhw, or resident",
      },
      default: "resident",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "resident",
  }
);

UserSchema.index({ role: 1, verified: 1 });
UserSchema.index({ organizationId: 1 });

UserSchema.pre("validate", function () {
  if (this.gender) {
    this.gender = this.gender.toLowerCase().trim();
  }
});

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  if (
    typeof this.password === "string" &&
    BCRYPT_HASH_PATTERN.test(this.password)
  ) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (passwordInput) {
  return bcrypt.compare(passwordInput, this.password);
};

UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model("User", UserSchema, "users");