-- مدير المدرسة يملك صلاحيات المالية كاملة دائمًا (حتى للمدارس الجديدة)
CREATE FUNCTION users_default_perms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.can_approve_finance := true;
    NEW.can_manage_payroll := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_default_perms BEFORE INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION users_default_perms();

UPDATE users SET can_approve_finance = true, can_manage_payroll = true WHERE role = 'admin';
