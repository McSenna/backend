const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const VALID_STATUSES = ["active", "inactive", "pending", "suspended"];

/** Statuses an administrator has explicitly barred from signing in. */
const BLOCKED_STATUSES = ["inactive", "suspended"];

/**
 * The account's effective status.
 *
 * Accounts created before `status` existed have no stored value, so it falls
 * back to what `verified` already implied. Every read path goes through this
 * rather than `user.status` so a missing field can never render as blank or
 * silently lock someone out.
 */
function resolveUserStatus(user) {
  if (!user) return "pending";
  if (user.status && VALID_STATUSES.includes(user.status)) return user.status;
  return user.verified ? "active" : "pending";
}

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
    phone: {
      type: String,
      default: "",
      trim: true,
      maxlength: [20, "Contact number must not exceed 20 characters"],
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    /**
     * Account standing, managed by an administrator.
     *
     * Deliberately separate from `verified`: that flag means "this person
     * proved they own the email address" and is owned by the signup/OTP flow,
     * while this one means "an admin allows this account to be used". Documents
     * written before this field existed have no value, so read paths resolve it
     * with resolveUserStatus() rather than trusting the raw field.
     */
    status: {
      type: String,
      trim: true,
      lowercase: true,
      enum: {
        values: VALID_STATUSES,
        message: "Status must be active, inactive, pending, or suspended",
      },
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
    /**
     * Timestamp of the last successful sign-in.
     *
     * Deliberately not derived from `updatedAt`: that moves whenever an admin
     * edits the account, so it would report activity the person never had.
     * Unset until the account signs in once, which the admin UI renders as
     * "Never" rather than as a date.
     */
    lastLogin: {
      type: Date,
      default: null,
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

const User = mongoose.model("User", UserSchema, "users");

module.exports = User;
module.exports.VALID_STATUSES = VALID_STATUSES;
module.exports.BLOCKED_STATUSES = BLOCKED_STATUSES;
module.exports.resolveUserStatus = resolveUserStatus;