    -- Reset passwords for all 4 users with fresh bcrypt hashes.
    -- Run each statement individually if needed.
    -- Passwords are hashed with pgcrypto crypt() + gen_salt('bf', 12) — compatible with bcryptjs compare().

    -- 1. Supervisor — R. Kannan
    UPDATE users
    SET password_hash = crypt('site123', gen_salt('bf', 12)),
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE username = 'supervisor';

    -- 2. Administrator — V. Sharma
    UPDATE users
    SET password_hash = crypt('admin123', gen_salt('bf', 12)),
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE username = 'admin';

    -- 3. A1 — M. Iyer
    UPDATE users
    SET password_hash = crypt('a1pass123', gen_salt('bf', 12)),
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE username = 'a1';

    -- 4. A1+ — K. Reddy
    UPDATE users
    SET password_hash = crypt('final123', gen_salt('bf', 12)),
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE username = 'a1plus';

    -- Verify all 4 users are present with updated hashes
    SELECT username, role, name, phone, created_at
    FROM users
    ORDER BY role;
